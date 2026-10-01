using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BotAdmin;

// Authenticated proxy to Rakazo's oRPC API (POST /rpc/<path>, body {"json": input}).
// "No login" for the user: a hidden owner account is created on first run; its password and the
// session cookie never leave this process. The page only gets JSON results.
static class RakazoClient
{
    const string Web = Monitor.RakazoUrl; // web origin also serves /rpc and /api/auth (and /novnc)
    const string Email = "owner@botteam.local";
    static readonly string CredFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BotTeam", "owner.json");
    // Node's keep-alive timeout is 5s; drop idle connections before that or a POST lands on a dead socket
    static readonly SocketsHttpHandler Handler = new()
    {
        CookieContainer = new CookieContainer(), UseCookies = true, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(3),
    };
    static readonly HttpClient Http = new(Handler, false) { BaseAddress = new Uri(Web), Timeout = TimeSpan.FromSeconds(60) };
    static readonly HttpClient Streams = new(Handler, false) { BaseAddress = new Uri(Web), Timeout = Timeout.InfiniteTimeSpan };
    static readonly SemaphoreSlim Gate = new(1, 1);
    static bool _ready;

    // what the page may call; everything else (models, deployment, spaces, auth) stays host-only
    static readonly string[] Allowed = ["bootstrap", "me", "bots/", "botSections/", "approvalRules/", "groups/", "threads/", "computer/", "runs/list", "mcp/",
        "routines/", "memory/list", "memory/update", // memory provider connect/config (credentials) stays host-only
        "usage/list", "usage/summary", "search/query", "artifacts/list", "artifacts/get", "artifacts/create",
        "skills/"];

    public static async Task<JsonNode?> Call(string path, JsonNode? input)
    {
        if (!Allowed.Any(a => a.EndsWith('/') ? path.StartsWith(a) : path == a) || path.Contains(".."))
            throw new InvalidOperationException("ไม่อนุญาต: " + path);
        await EnsureReady();
        return await Rpc(path, input);
    }

    // LLM mode = the account's default model; bots without their own model follow it. "local" = Gemma on llama-server
    // (openai-compatible credential), "deepseek" = cloud (key file, connected on first use). The page only picks a
    // mode; keys and model credentials stay in this process.
    // pi-ai in Rakazo v0.1.6 predates the "deepseek-flash" name; this catalog id declares image input (computer use)
    // and DeepSeek serves it with deepseek-flash (V4.1-Flash)
    const string DeepSeekModel = "deepseek-v4-flash-vision-exp";
    const string DeepSeekKeyFile = Monitor.Root + @"\deepseek-api-key.txt";

    public static async Task<object> GetLlmMode()
    {
        await EnsureReady();
        var d = (await Rpc("models/credentials", null))!.AsArray().FirstOrDefault(c => c!["isDefault"]!.GetValue<bool>());
        return new { mode = d?["provider"]?.GetValue<string>() == "deepseek" ? "deepseek" : "local", model = d?["modelId"]?.GetValue<string>() ?? "" };
    }

    public static async Task<object> SetLlmMode(string mode)
    {
        await EnsureReady();
        var creds = (await Rpc("models/credentials", null))!.AsArray();
        JsonNode? Cred(string provider) => creds.FirstOrDefault(c => c!["provider"]!.GetValue<string>() == provider);
        if (mode == "local")
        {
            var local = Cred("openai-compatible") ?? throw new InvalidOperationException("ไม่พบ Local model ใน Rakazo");
            await Rpc("models/setDefault", new JsonObject { ["provider"] = "openai-compatible", ["modelId"] = local["modelId"]!.GetValue<string>() });
        }
        else if (mode == "deepseek")
        {
            if (Cred("deepseek") is null)
            {
                var key = File.Exists(DeepSeekKeyFile) ? File.ReadLines(DeepSeekKeyFile).Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("sk-")) : null;
                await Rpc("models/connect", new JsonObject
                {
                    ["provider"] = "deepseek", ["modelId"] = DeepSeekModel,
                    ["apiKey"] = key ?? throw new InvalidOperationException("ไม่พบ DeepSeek API key ใน " + DeepSeekKeyFile),
                });
            }
            await Rpc("models/setDefault", new JsonObject { ["provider"] = "deepseek", ["modelId"] = DeepSeekModel });
        }
        else throw new ArgumentException("mode ต้องเป็น local หรือ deepseek");
        return await GetLlmMode();
    }

    public static async Task<CookieCollection> SessionCookies()
    {
        await EnsureReady();
        return Handler.CookieContainer.GetCookies(new Uri(Web));
    }

    static async Task<JsonNode?> Rpc(string path, JsonNode? input, bool retry = true)
    {
        using var res = await Http.PostAsync("/rpc/" + path, Body(new JsonObject { ["json"] = input?.DeepClone() }));
        var text = await res.Content.ReadAsStringAsync();
        if (res.StatusCode == HttpStatusCode.Unauthorized && retry)
        {
            _ready = false;
            await EnsureReady();
            return await Rpc(path, input, false);
        }
        var body = text.Length > 0 ? JsonNode.Parse(text) : null;
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(body?["json"]?["message"]?.GetValue<string>() ?? $"Rakazo {(int)res.StatusCode}");
        return body?["json"];
    }

    static StringContent Body(JsonNode node) => new(node.ToJsonString(), Encoding.UTF8, "application/json");

    // Sign in (or sign up the first time), then make sure the local model is connected.
    static async Task EnsureReady()
    {
        if (_ready) return;
        await Gate.WaitAsync();
        try
        {
            if (_ready) return;
            var cred = LoadOrCreatePassword(out var isNew);
            if (!await Auth("sign-in/email", new JsonObject { ["email"] = Email, ["password"] = cred }))
            {
                if (!isNew) throw new InvalidOperationException("ล็อกอิน Rakazo ไม่ได้ (บัญชีเจ้าของใน owner.json ไม่ตรงกับฐานข้อมูล)");
                if (!await Auth("sign-up/email", new JsonObject { ["name"] = "ลุงจืด", ["email"] = Email, ["password"] = cred }))
                    throw new InvalidOperationException("สร้างบัญชีเจ้าของใน Rakazo ไม่ได้");
            }
            var me = await Rpc("me", null, false);
            if (me?["needsModel"]?.GetValue<bool>() == true) await ConnectModel();
            _ready = true;
        }
        finally { Gate.Release(); }
    }

    static async Task<bool> Auth(string endpoint, JsonObject body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/" + endpoint) { Content = Body(body) };
        req.Headers.Add("Origin", Web); // better-auth checks Origin once a cookie is present
        using var res = await Http.SendAsync(req);
        return res.IsSuccessStatusCode;
    }

    static string LoadOrCreatePassword(out bool isNew)
    {
        isNew = !File.Exists(CredFile);
        if (!isNew) return JsonNode.Parse(File.ReadAllText(CredFile))!["password"]!.GetValue<string>();
        // ponytail: plain file under the user's %LOCALAPPDATA% (user-only ACL); DPAPI if the machine is shared
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        Directory.CreateDirectory(Path.GetDirectoryName(CredFile)!);
        File.WriteAllText(CredFile, new JsonObject { ["email"] = Email, ["password"] = password }.ToJsonString());
        return password;
    }

    static async Task ConnectModel()
    {
        var key = File.ReadLines(Path.Combine(Monitor.Root, "llm-api-key.txt"))
            .Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("rakazo-"))
            ?? throw new InvalidOperationException("ไม่พบคีย์ rakazo- ใน llm-api-key.txt");
        await Rpc("models/connect", new JsonObject
        {
            ["provider"] = "openai-compatible",
            ["baseUrl"] = "http://172.17.0.1:18080/v1", // socat bridge on docker0 -> Windows llama-server
            ["modelId"] = "gemma4",
            ["apiKey"] = key,
            ["label"] = "Gemma 4 (เครื่องนี้)",
            ["reasoning"] = false,
        }, false);
    }

    // threads.subscribe as SSE; reconnects from the last seen seq until cancelled.
    public static async Task Subscribe(JsonObject target, long cursor, Action<JsonNode> onEvent, CancellationToken ct)
    {
        await EnsureReady();
        var delay = 250;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var input = (JsonObject)target.DeepClone();
                input["cursor"] = cursor;
                using var req = new HttpRequestMessage(HttpMethod.Post, "/rpc/threads/subscribe") { Content = Body(new JsonObject { ["json"] = input }) };
                using var res = await Streams.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                if (res.StatusCode == HttpStatusCode.Unauthorized) { _ready = false; await EnsureReady(); continue; }
                res.EnsureSuccessStatusCode();
                using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
                string? line, ev = null;
                while ((line = await reader.ReadLineAsync(ct)) != null)
                {
                    if (line.StartsWith("event: ")) ev = line[7..];
                    else if (line.StartsWith("data: ") && ev == "message")
                    {
                        var e = JsonNode.Parse(line[6..])?["json"];
                        if (e == null) continue;
                        cursor = Math.Max(cursor, e["seq"]?.GetValue<long>() ?? cursor);
                        onEvent(e);
                        delay = 250;
                    }
                    else if (line.StartsWith("data: ") && ev == "error")
                        throw new InvalidOperationException(JsonNode.Parse(line[6..])?["json"]?["message"]?.GetValue<string>() ?? "stream error");
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception) when (!ct.IsCancellationRequested) { /* API restart / network blip: back off and resume from cursor */ }
            await Task.Delay(delay, ct).ContinueWith(_ => { });
            delay = Math.Min(delay * 2, 5000);
        }
    }
}
