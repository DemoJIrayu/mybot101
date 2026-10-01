using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace BotAdmin;

public record Gpu(string Name, int VramUsed, int VramTotal, int Util, int Temp, double Power);
public record Llm(bool Process, string Health, string Model, int Slots, int Busy, int Deferred, double Tps, long TokensOut);
public record Box(string Name, bool Bot, string State, string Status, string Cpu, string Mem);
public record Rakazo(bool KeepAlive, string Health, List<Box> Boxes);
public record Distro(string Name, string State);
public record Snapshot(Gpu? Gpu, double CpuPct, double RamUsedGb, double RamTotalGb, Llm Llm, List<Distro> Wsl, Rakazo Rakazo);

public static class Monitor
{
    public const string Root = @"D:\localai";
    public const string LlmUrl = "http://127.0.0.1:8080";
    public const string LlmBat = Root + @"\serve-th.bat";
    public const string LlmLog = Root + @"\logs\llama-server.log";
    public const string DistroName = "Ubuntu-24.04";
    public const string RakazoUrl = "http://127.0.0.1:5173";
    const string RakazoApi = "http://127.0.0.1:3110";
    const string RakazoSh = "/mnt/d/localai/botadmin/rakazo.sh";
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };

    // admin key = the "gemma-" line; never shown in UI or logs
    static string AdminKey() => File.ReadLines(Root + @"\llm-api-key.txt").First(l => l.StartsWith("gemma-"));

    public static string Run(string exe, string args, Encoding? enc = null)
    {
        try
        {
            var psi = new ProcessStartInfo(exe, args) { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            if (enc != null) psi.StandardOutputEncoding = enc;
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(10000);
            return output;
        }
        catch { return ""; }
    }

    public static Gpu? ParseGpu(string csv)
    {
        var f = csv.Trim().Split(',').Select(s => s.Trim()).ToArray();
        if (f.Length < 6) return null;
        static int I(string s) => int.TryParse(s, out var v) ? v : 0;
        return new Gpu(f[0], I(f[1]), I(f[2]), I(f[3]), I(f[4]),
            double.TryParse(f[5], NumberStyles.Float, CultureInfo.InvariantCulture, out var w) ? w : 0);
    }

    public static Dictionary<string, double> ParseMetrics(string text) =>
        text.Split('\n').Where(l => l.StartsWith("llamacpp:"))
            .Select(l => l.Trim().Split(' '))
            .Where(p => p.Length == 2 && double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            .ToDictionary(p => p[0]["llamacpp:".Length..], p => double.Parse(p[1], CultureInfo.InvariantCulture));

    public static List<Distro> ParseWsl(string text) =>
        text.Replace("\0", "").Split('\n').Skip(1)
            .Select(l => l.Trim().TrimStart('*').Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .Where(p => p.Length >= 2).Select(p => new Distro(p[0], p[1])).ToList();

    static async Task<string?> Get(string path, bool auth, string baseUrl = LlmUrl)
    {
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + path);
            if (auth) req.Headers.Authorization = new("Bearer", AdminKey());
            var r = await Http.SendAsync(req);
            return r.IsSuccessStatusCode ? await r.Content.ReadAsStringAsync() : null;
        }
        catch { return null; }
    }

    static async Task<Llm> ReadLlm()
    {
        bool proc = Process.GetProcessesByName("llama-server").Length > 0;
        var health = await Get("/health", false);
        if (health == null || !health.Contains("ok"))
            return new(proc, proc ? "กำลังโหลด" : "ปิดอยู่", "-", 0, 0, 0, 0, 0);
        var model = "-";
        try { model = JsonDocument.Parse(await Get("/v1/models", false) ?? "{}").RootElement.GetProperty("data")[0].GetProperty("id").GetString() ?? "-"; } catch { }
        int slots = 0, busy = 0;
        try
        {
            var arr = JsonDocument.Parse(await Get("/slots", true) ?? "[]").RootElement;
            slots = arr.GetArrayLength();
            busy = arr.EnumerateArray().Count(s => s.GetProperty("is_processing").GetBoolean());
        }
        catch { }
        var m = ParseMetrics(await Get("/metrics", true) ?? "");
        return new(proc, "พร้อม", model, slots, busy, (int)m.GetValueOrDefault("requests_deferred"),
            m.GetValueOrDefault("predicted_tokens_seconds"), (long)m.GetValueOrDefault("tokens_predicted_total"));
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MemStatus { public uint Len, Load; public ulong Total, Avail, TotalPage, AvailPage, TotalVirt, AvailVirt, AvailExt; }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MemStatus m);
    [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
    static long _idle, _total;

    // CPU % since the previous call (kernel time includes idle time)
    static double Cpu()
    {
        GetSystemTimes(out var idle, out var kernel, out var user);
        long total = kernel + user;
        double pct = total == _total ? 0 : 100.0 * (1 - (double)(idle - _idle) / (total - _total));
        (_idle, _total) = (idle, total);
        return Math.Round(Math.Clamp(pct, 0, 100), 1);
    }

    public static async Task<Snapshot> Read()
    {
        var gpu = ParseGpu(Run("nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits"));
        var mem = new MemStatus { Len = (uint)Marshal.SizeOf<MemStatus>() };
        GlobalMemoryStatusEx(ref mem);
        const double GB = 1024.0 * 1024 * 1024;
        var wsl = ParseWsl(Run("wsl.exe", "-l -v", Encoding.Unicode));
        return new(gpu, Cpu(), Math.Round((mem.Total - mem.Avail) / GB, 1), Math.Round(mem.Total / GB, 1), await ReadLlm(), wsl, await ReadRakazo(wsl));
    }

    static string Sh(string args) => Run("wsl.exe", $"-d {DistroName} --exec bash {RakazoSh} {args}", Encoding.UTF8);

    // lines from rakazo.sh status: "KEEPALIVE 0|1", "C <json>" compose, "B <json>" bot computer, "S <json>" docker stats
    public static (bool KeepAlive, List<Box> Boxes) ParseRakazo(string text)
    {
        var stats = new Dictionary<string, (string Cpu, string Mem)>();
        var rows = new List<(string Container, string Name, bool Bot, string State, string Status)>();
        bool keep = false;
        foreach (var line in text.Split('\n').Select(l => l.Trim()))
        {
            if (line == "KEEPALIVE 1") keep = true;
            if (line.Length < 3 || line[1] != ' ' || !"CBS".Contains(line[0])) continue;
            try
            {
                var j = JsonDocument.Parse(line[2..]).RootElement;
                string P(string k) => j.TryGetProperty(k, out var v) ? v.GetString() ?? "" : "";
                if (line[0] == 'S') { stats[P("Name")] = (P("CPUPerc"), P("MemUsage").Split(" / ")[0]); continue; }
                var container = P("Names");
                var name = container.Replace("rakazo-", "").Replace("-1", "");
                if (line[0] == 'B')
                {
                    var bot = P("Labels").Split(',').FirstOrDefault(l => l.StartsWith("rakazo.botId="))?[13..] ?? container;
                    name = "บอท " + bot[..Math.Min(12, bot.Length)] + " (" + container + ")";
                }
                rows.Add((container, name, line[0] == 'B', P("State"), P("Status")));
            }
            catch (JsonException) { }
        }
        var boxes = rows.Select(r => stats.TryGetValue(r.Container, out var st)
                ? new Box(r.Name, r.Bot, r.State, r.Status, st.Cpu, st.Mem) : new Box(r.Name, r.Bot, r.State, r.Status, "-", "-"))
            .OrderBy(b => b.Bot).ThenBy(b => b.Name).ToList();
        return (keep, boxes);
    }

    static async Task<Rakazo> ReadRakazo(List<Distro> wsl)
    {
        // don't start the distro just to look at it
        if (!wsl.Any(w => w.Name == DistroName && w.State == "Running")) return new(false, "Ubuntu ปิดอยู่", []);
        var (keep, boxes) = ParseRakazo(Sh("status"));
        var health = "ปิดอยู่";
        try
        {
            var h = JsonDocument.Parse(await Get("/health", false, RakazoApi) ?? "{}").RootElement;
            if (h.GetProperty("ok").GetBoolean()) health = "พร้อม (sandbox: " + h.GetProperty("sandbox").GetString() + ")";
        }
        catch { }
        return new(keep, health, boxes);
    }

    public static void StartRakazo()
    {
        // WSL stops an idle distro after ~15s even with docker running; a hidden "sleep infinity" keeps it up
        if (!Sh("status").Contains("KEEPALIVE 1"))
            Process.Start(new ProcessStartInfo("wsl.exe", $"-d {DistroName} --exec sleep infinity") { UseShellExecute = false, CreateNoWindow = true });
        var o = Sh("start");
        if (o.Contains("ERR") || o.Contains("error", StringComparison.OrdinalIgnoreCase)) throw new Exception(o.Trim().Split('\n').Last());
    }

    public static void StopRakazo() => Sh("stop");

    // full backup (database dump + app data + hotfixes + demo accounting book) into D:\localai\backups\rakazo-<time>
    public static object Backup()
    {
        var o = Sh("backup");
        var ok = o.Split('\n').FirstOrDefault(l => l.StartsWith("OK "));
        if (ok == null) throw new Exception(o.Trim().Split('\n').LastOrDefault() ?? "สำรองข้อมูลไม่สำเร็จ");
        var dir = ok[3..].Trim().Replace("/mnt/d/", @"D:\").Replace('/', '\\');
        return new { dir, mb = Math.Round(new DirectoryInfo(dir).EnumerateFiles().Sum(f => f.Length) / 1048576.0, 1) };
    }

    public static void StartLlm()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LlmLog)!);
        // same .bat as a double-click; stdin is closed so its final "pause" exits when the server stops
        var psi = new ProcessStartInfo("cmd.exe", $"/s /c \"\"{LlmBat}\" > \"{LlmLog}\" 2>&1\"")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true };
        Process.Start(psi)!.StandardInput.Close();
    }

    // llama-server can wedge mid-decode (llama.cpp #27388, #21375): /health stays ok but the main loop never answers
    // /metrics again and every bot waits forever. Called every 15 s; restarts it after 3 min of that (the stuck run fails
    // and can be re-sent). ponytail: long image re-encodes (mmproj on CPU, ~7 s each) also block /metrics, hence 3 min not 30 s.
    static int wedgedChecks;
    public static async Task LlmWatchdog()
    {
        var health = Process.GetProcessesByName("llama-server").Length > 0 ? await Get("/health", false) : null;
        if (health == null || !health.Contains("ok")) { wedgedChecks = 0; return; } // down or loading: not a wedge
        wedgedChecks = await Get("/metrics", true) == null ? wedgedChecks + 1 : 0;
        if (wedgedChecks < 12) return;
        wedgedChecks = 0;
        try { File.Copy(LlmLog, LlmLog.Replace(".log", $".wedged-{DateTime.Now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture)}.log"), true); } catch { }
        StopLlm();
        StartLlm();
    }

    public static void StopLlm()
    {
        foreach (var p in Process.GetProcessesByName("llama-server")) { p.Kill(true); p.WaitForExit(10000); }
    }

    public static string LogTail(string source = "llama-server", int lines = 200)
    {
        if (source.StartsWith("rakazo "))
            return Sh("logs " + source[7..]) is { Length: > 0 } rl ? rl : "(ไม่มี log — Ubuntu หรือ Rakazo ปิดอยู่)";
        if (!File.Exists(LlmLog)) return "(ยังไม่มี log — จะมีเมื่อเปิด LLM จากแอปนี้)";
        using var fs = new FileStream(LlmLog, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        fs.Seek(Math.Max(0, fs.Length - 64 * 1024), SeekOrigin.Begin); // ponytail: last 64KB covers 200 lines
        return string.Join('\n', new StreamReader(fs).ReadToEnd().Split('\n').TakeLast(lines));
    }

    // --selftest: parser asserts on fixed samples + one live snapshot; exit code 0 = pass
    public static async Task<int> SelfTest(TextWriter o)
    {
        var fails = new List<string>();
        void Check(bool ok, string name) { if (!ok) fails.Add(name); }
        var g = ParseGpu("NVIDIA GeForce RTX 5060 Ti, 15082, 16311, 97, 61, 142.35");
        Check(g is { VramUsed: 15082, VramTotal: 16311, Util: 97, Temp: 61, Power: 142.35 }, "ParseGpu");
        Check(ParseGpu("") == null, "ParseGpu empty");
        var m = ParseMetrics("# HELP x\nllamacpp:predicted_tokens_seconds 76.7097\nllamacpp:requests_deferred 2\nbad line\n");
        Check(m.Count == 2 && m["predicted_tokens_seconds"] == 76.7097 && m["requests_deferred"] == 2, "ParseMetrics");
        var w = ParseWsl("  NAME              STATE           VERSION\n* Ubuntu-24.04      Running         2\n  docker-desktop    Stopped         2\n");
        Check(w.Count == 2 && w[0] == new Distro("Ubuntu-24.04", "Running") && w[1] == new Distro("docker-desktop", "Stopped"), "ParseWsl");
        var (keep, boxes) = ParseRakazo("KEEPALIVE 1\n" +
            "C {\"Names\":\"rakazo-api-1\",\"State\":\"running\",\"Status\":\"Up 5 minutes (healthy)\",\"Labels\":\"a=b\"}\n" +
            "B {\"Names\":\"rakazo-bot-x\",\"State\":\"running\",\"Status\":\"Up 1 minute\",\"Labels\":\"rakazo.managed=true,rakazo.botId=bot_123\"}\n" +
            "S {\"Name\":\"rakazo-api-1\",\"CPUPerc\":\"0.32%\",\"MemUsage\":\"516.6MiB / 1.5GiB\"}\nnoise\nC {broken json\n");
        Check(keep && boxes.Count == 2 && boxes[0] == new Box("api", false, "running", "Up 5 minutes (healthy)", "0.32%", "516.6MiB")
            && boxes[1].Bot && boxes[1].Name.Contains("bot_123") && boxes[1].Cpu == "-", "ParseRakazo");
        Cpu(); await Task.Delay(500);
        var s = await Read();
        Check(s.Gpu is { VramTotal: > 0 }, "live GPU");
        Check(s.RamTotalGb > 1 && s.CpuPct is >= 0 and <= 100, "live CPU/RAM");
        Check(s.Wsl.Count > 0, "live WSL");
        Check(s.Rakazo.Health.StartsWith("พร้อม") || s.Rakazo.Health == "Ubuntu ปิดอยู่" || s.Rakazo.Health == "ปิดอยู่", "live Rakazo");
        o.WriteLine(JsonSerializer.Serialize(new { s.Gpu, s.CpuPct, s.RamUsedGb, s.RamTotalGb, s.Llm, s.Wsl, s.Rakazo },
            new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        o.WriteLine(fails.Count == 0 ? "SELFTEST PASS" : "SELFTEST FAIL: " + string.Join(", ", fails));
        return fails.Count == 0 ? 0 : 1;
    }
}
