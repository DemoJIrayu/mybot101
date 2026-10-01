using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;

namespace BotAdmin;

// Thai speech-to-text for the mic button: stt.py (faster-whisper medium on CPU, the GPU belongs to the LLM) runs as one
// long-lived python process started on first use; one clip at a time. Models come from the local HF cache, never downloaded.
static class Speech
{
    static readonly SemaphoreSlim Gate = new(1, 1);
    static Process? _py;

    // called when recording starts so the model is loaded by the time the user stops talking
    public static async Task Warm()
    {
        await Gate.WaitAsync();
        try { await Ensure(); } finally { Gate.Release(); }
    }

    public static async Task<JsonNode> Transcribe(string base64)
    {
        if (base64.Length is 0 or > 14_000_000) throw new ArgumentException("ไฟล์เสียงว่างหรือยาวเกินไป"); // ~10 MB ≈ 10 min of opus
        var file = Path.Combine(Path.GetTempPath(), $"botteam-stt-{Guid.NewGuid():N}.webm");
        await File.WriteAllBytesAsync(file, Convert.FromBase64String(base64));
        await Gate.WaitAsync();
        try
        {
            string? line;
            try
            {
                await Ensure();
                await _py!.StandardInput.WriteLineAsync(file);
                line = await _py.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(120));
            }
            catch { Stop(); throw; } // hung or dead worker: start fresh next time
            var r = JsonNode.Parse(line ?? throw new InvalidOperationException("ตัวแปลงเสียงหยุดทำงาน"))!;
            if (r["error"] is { } err) throw new InvalidOperationException("แปลงเสียงไม่ได้: " + err);
            return r;
        }
        finally { Gate.Release(); File.Delete(file); }
    }

    static async Task Ensure()
    {
        if (_py is { HasExited: false }) return;
        var psi = new ProcessStartInfo("python", $"\"{Path.Combine(AppContext.BaseDirectory, "stt.py")}\" medium")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
        };
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        _py = Process.Start(psi) ?? throw new InvalidOperationException("เปิด python ไม่ได้");
        // stdin closes when this app exits, so the worker ends with it
        var ready = await _py.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(180)).ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : null);
        if (ready?.Contains("\"ready\"") != true) { Stop(); throw new InvalidOperationException("โหลดโมเดลแปลงเสียง (faster-whisper) ไม่สำเร็จ"); }
    }

    static void Stop()
    {
        try { _py?.Kill(); } catch { /* already gone */ }
        _py = null;
    }
}
