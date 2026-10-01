using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace BotAdmin;

// Host window: WebView2 renders ui/*.html; the page talks to C# only through postMessage (see Dispatch).
// Secrets (LLM key, Rakazo session) stay in C#; the page never sees them.
public partial class MainWindow : Window
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    readonly int _devtoolsPort;
    readonly Dictionary<int, CancellationTokenSource> _subs = []; // UI thread only

    public MainWindow(int devtoolsPort = 0)
    {
        _devtoolsPort = devtoolsPort;
        InitializeComponent();
        SourceInitialized += (_, _) => DarkTitleBar(this);
        Loaded += async (_, _) => await InitWeb();
        _ = Task.Run(async () => { while (true) { await Task.Delay(15000); try { await Monitor.LlmWatchdog(); } catch { } } });
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    static void DarkTitleBar(Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        int on = 1, caption = 0x000C0B0B; // COLORREF 0x00BBGGRR = #0B0B0C
        DwmSetWindowAttribute(hwnd, 20, ref on, 4);       // DWMWA_USE_IMMERSIVE_DARK_MODE
        DwmSetWindowAttribute(hwnd, 35, ref caption, 4);  // DWMWA_CAPTION_COLOR (Windows 11)
    }

    async Task InitWeb()
    {
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BotTeam", "WebView2");
        var opts = new CoreWebView2EnvironmentOptions(_devtoolsPort > 0 ? $"--remote-debugging-port={_devtoolsPort}" : null);
        await Web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, data, opts));
        // ui/ files change with app updates; never serve a stale cached copy
        await Web.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
        var ui = Environment.GetEnvironmentVariable("BOTTEAM_UI_DIR") is { Length: > 0 } dev ? dev : Path.Combine(AppContext.BaseDirectory, "ui");
        var core = Web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("botteam.example", ui, CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDefaultContextMenusEnabled = _devtoolsPort > 0;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = _devtoolsPort > 0;
        core.WebMessageReceived += OnMessage;
        // the mic button (speech-to-text) is the only permission our own page gets
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.Microphone && e.Uri.StartsWith("https://botteam.example/"))
                e.State = CoreWebView2PermissionState.Allow;
        };
        // links the page opens (Rakazo web, llama web UI) go to the default browser, never inside the app
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.Navigate("https://botteam.example/index.html");
    }

    static void OpenExternal(string url)
    {
        if (url.StartsWith("http://127.0.0.1:") || url.StartsWith("http://localhost:"))
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    // Shell inside the bot's own Linux computer (its dedicated container in WSL), as the same unprivileged user the bot runs as.
    static async Task OpenTerminal(string botId, string name)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(botId, "^[a-z0-9]{8,40}$")) throw new ArgumentException("botId ไม่ถูกต้อง");
        var id = new JsonObject { ["botId"] = botId };
        string Cid() => Monitor.Run("wsl.exe", $"-d {Monitor.DistroName} --exec docker ps -q --filter label=rakazo.botId={botId}").Split('\n')[0].Trim();
        var cid = await Task.Run(Cid);
        if (cid == "")
        {
            await RakazoClient.Call("computer/boot", id);
            for (var i = 0; i < 60 && (cid = await Task.Run(Cid)) == ""; i++) await Task.Delay(1000);
        }
        if (!System.Text.RegularExpressions.Regex.IsMatch(cid, "^[0-9a-f]{12,64}$")) throw new Exception("เปิด Computer ของบอทไม่สำเร็จ");
        // a GUI parent gives the console app its own new window; name/prompt travel in the environment (WSLENV), never the command line
        var psi = new ProcessStartInfo("wsl.exe", $"-d {Monitor.DistroName} --exec docker exec -it -u 1000 -w /home/rakazo -e HOME=/home/rakazo -e BOT_NAME -e PS1 -e PROMPT_COMMAND -e BOT_INIT {cid} bash --norc -i") { UseShellExecute = false };
        psi.Environment["BOT_NAME"] = name;
        psi.Environment["PS1"] = @"\[\e]0;${BOT_NAME} · Linux\a\e[1;35m\]${BOT_NAME}\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]$ ";
        // runs once before the first prompt: colours + a banner, so an empty home does not look like a dead shell
        psi.Environment["PROMPT_COMMAND"] = "eval \"$BOT_INIT\"; unset PROMPT_COMMAND BOT_INIT";
        psi.Environment["BOT_INIT"] = """
            alias ls='ls --color=auto' ll='ls -alF --color=auto' grep='grep --color=auto'
            ( . /etc/os-release; read q p < /sys/fs/cgroup/cpu.max; m=$(cat /sys/fs/cgroup/memory.max)
              [ "$q" = max ] && q=$(nproc) p=1; [ "$m" = max ] && m=0
              printf '\e[1;35m%s\e[0m · Linux ส่วนตัวของบอทตัวนี้ (container แยกจากบอทอื่น)\n' "$BOT_NAME"
              printf '%s · CPU %s core · RAM %s GB · user %s (ไม่มี sudo)\n' "$PRETTY_NAME" "$((q / p))" "$((m / 1073741824))" "$(whoami)"
              printf 'ไฟล์งานของบอท: %s (%s รายการ) · ลอง: ll, ps aux, df -h, python3, node · exit = ปิด\n\n' "$HOME" "$(ls -A | wc -l)" )
            """;
        psi.Environment["WSLENV"] = "BOT_NAME/u:PS1/u:PROMPT_COMMAND/u:BOT_INIT/u";
        AllowSetForegroundWindow(-1); // let the new console window come to the front
        var p = Process.Start(psi)!;
        // Rakazo stops an idle computer after 10 min; keep it alive while this window is open
        _ = Task.Run(async () => { while (!p.WaitForExit(60000)) try { await RakazoClient.Call("computer/heartbeat", id); } catch { } });
    }

    // Full Rakazo web UI in an app window, signed in as the same hidden account (same bots as BotTeam).
    async Task OpenRakazoWeb(string path)
    {
        var cookies = await RakazoClient.SessionCookies();
        var view = new Microsoft.Web.WebView2.Wpf.WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(11, 11, 12) };
        var win = new Window { Title = "Rakazo", Width = 1320, Height = 880, Owner = this, Content = view, Background = System.Windows.Media.Brushes.Black };
        win.SourceInitialized += (_, _) => DarkTitleBar(win);
        win.Show();
        await view.EnsureCoreWebView2Async(Web.CoreWebView2.Environment);
        var jar = view.CoreWebView2.CookieManager;
        foreach (System.Net.Cookie c in cookies)
        {
            var cookie = jar.CreateCookie(c.Name, c.Value, "127.0.0.1", "/");
            cookie.IsHttpOnly = true;
            jar.AddOrUpdateCookie(cookie);
        }
        view.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; view.CoreWebView2.Navigate(e.Uri); };
        view.CoreWebView2.Navigate(Monitor.RakazoUrl + (path.StartsWith('/') ? path : "/app"));
    }

    // Windows notification when a bot needs you and the app is in the background (a balloon shows as a toast on
    // Windows 10/11); clicking it brings the app forward on the given page. In front, the page's own toast is enough.
    System.Windows.Forms.NotifyIcon? _tray;
    JsonNode? _notifyRoute;

    object Notify(string title, string body, JsonNode? route, bool force)
    {
        if (IsActive && WindowState != WindowState.Minimized && !force) return new { shown = false };
        if (_tray == null)
        {
            _tray = new() { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!), Text = "BotTeam", Visible = true };
            _tray.BalloonTipClicked += (_, _) =>
            {
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
                Activate();
                if (_notifyRoute != null) Post(new { nav = _notifyRoute });
            };
            _tray.Click += (_, _) => { if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal; Activate(); };
            Closed += (_, _) => _tray.Dispose();
        }
        _notifyRoute = route?.DeepClone();
        _tray.ShowBalloonTip(8000, title, body, System.Windows.Forms.ToolTipIcon.Info);
        return new { shown = true };
    }

    public void Post(object message) =>
        Dispatcher.InvokeAsync(() => Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json)));

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? id = null;
        try
        {
            var msg = JsonNode.Parse(e.WebMessageAsJson)!;
            id = msg["id"]?.DeepClone();
            var result = await Dispatch(msg["op"]!.GetValue<string>(), msg["args"]);
            Post(new { id, ok = true, result });
        }
        catch (Exception ex) { Post(new { id, ok = false, error = ex.Message }); }
    }

    async Task<object?> Dispatch(string op, JsonNode? args)
    {
        string Arg(string k) => args?[k]?.GetValue<string>() ?? "";
        switch (op)
        {
            case "snapshot": return await Task.Run(Monitor.Read);
            case "logs": return await Task.Run(() => Monitor.LogTail(Arg("source")));
            case "llm.start": await Task.Run(Monitor.StartLlm); return null;
            case "llm.stop": await Task.Run(Monitor.StopLlm); return null;
            case "llm.restart": await Task.Run(() => { Monitor.StopLlm(); Monitor.StartLlm(); }); return null;
            case "rakazo.start": await Task.Run(Monitor.StartRakazo); return null;
            case "rakazo.stop": await Task.Run(Monitor.StopRakazo); return null;
            case "open": OpenExternal(Arg("url")); return null;
            case "rakazo.web": await OpenRakazoWeb(Arg("path")); return null;
            case "bot.terminal": await OpenTerminal(Arg("botId"), Arg("name")); return null;
            case "llm.mode": return await RakazoClient.GetLlmMode();
            case "llm.mode.set": return await RakazoClient.SetLlmMode(Arg("mode"));
            case "rk": return await RakazoClient.Call(Arg("path"), args?["input"]);
            case "rakazo.backup": return await Task.Run(Monitor.Backup);
            case "open.folder": // only our own backups folder
                if (Path.GetFullPath(Arg("path")) is var dir && dir.StartsWith(Monitor.Root + @"\backups\") && Directory.Exists(dir))
                    Process.Start(new ProcessStartInfo("explorer.exe", $"\"{dir}\"") { UseShellExecute = true });
                return null;
            case "stt.warm": await Speech.Warm(); return null;
            case "stt": return await Speech.Transcribe(Arg("audio"));
            case "notify": return Notify(Arg("title"), Arg("body"), args?["route"], args?["force"]?.GetValue<bool>() == true);
            case "rk.subscribe":
            {
                var sub = args!["sub"]!.GetValue<int>();
                var cts = new CancellationTokenSource();
                _subs[sub] = cts;
                _ = RakazoClient.Subscribe(args["target"]!.AsObject(), args["cursor"]!.GetValue<long>(),
                    e => Post(new { sub, @event = e }), cts.Token);
                return null;
            }
            case "sub.close":
                if (_subs.Remove(args!["sub"]!.GetValue<int>(), out var c)) c.Cancel();
                return null;
            default: throw new InvalidOperationException("unknown op: " + op);
        }
    }
}
