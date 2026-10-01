using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;

namespace BotAdmin;

// Host side of the round-4 company features: one-shot local LLM calls (digest, plan), events from the demo accounting
// book, and the watched inbox folder. Keys stay here; the page only gets results.
public static class Company
{
    static readonly HttpClient Llm = new() { Timeout = TimeSpan.FromSeconds(180) };
    public const string InboxDir = Monitor.Root + @"\inbox";
    // the book the demo-accounting MCP server persists after every write (read-only here; the token is never needed)
    static readonly string BookFile = $@"\\wsl.localhost\{Monitor.DistroName}\home\rakazo\rakazo\demo-acct\data.json";
    const long MaxFile = 10 * 1024 * 1024; // Rakazo artifacts/create limit

    // Gemma on llama-server, thinking off; the page asks for JSON in the prompt and parses it
    public static async Task<object> Ask(string system, string prompt, int maxTokens)
    {
        var body = new JsonObject
        {
            ["model"] = "gemma4", ["temperature"] = 0.2, ["max_tokens"] = Math.Clamp(maxTokens, 50, 4000),
            ["chat_template_kwargs"] = new JsonObject { ["enable_thinking"] = false },
            ["messages"] = new JsonArray(new JsonObject { ["role"] = "system", ["content"] = system }, new JsonObject { ["role"] = "user", ["content"] = prompt }),
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, Monitor.LlmUrl + "/v1/chat/completions") { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        req.Headers.Authorization = new("Bearer", Monitor.AdminKey());
        using var res = await Llm.SendAsync(req);
        var json = JsonNode.Parse(await res.Content.ReadAsStringAsync());
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException("LLM " + (int)res.StatusCode + ": " + (json?["error"]?["message"]?.GetValue<string>() ?? ""));
        return new { text = json?["choices"]?[0]?["message"]?["content"]?.GetValue<string>() ?? "" };
    }

    // journal entries after sequence `after`; money stays integer satang, sent as a string
    public static object AcctEvents(long after)
    {
        var book = JsonNode.Parse(File.ReadAllText(BookFile))!;
        long Seq(JsonNode je) => long.Parse(je["id"]!.GetValue<string>()[3..]);
        var journal = book["journal"]!.AsArray().Select(j => j!).ToList();
        var events = journal.Where(je => Seq(je) > after).Select(je => new
        {
            seq = Seq(je), id = je["id"]!.GetValue<string>(), @ref = je["ref"]?.GetValue<string>() ?? "", memo = je["memo"]?.GetValue<string>() ?? "",
            date = je["date"]?.GetValue<string>() ?? "", amount = je["lines"]!.AsArray().Sum(l => l!["debit"]!.GetValue<long>()).ToString(),
        }).ToList();
        return new { last = journal.Count == 0 ? 0 : journal.Max(Seq), events };
    }

    public static object InboxList()
    {
        Directory.CreateDirectory(InboxDir);
        return new DirectoryInfo(InboxDir).EnumerateFiles().Select(f => new { name = f.Name, size = f.Length, at = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds() }).ToList();
    }

    public static object InboxRead(string name)
    {
        // a bare file name inside the inbox folder only (no paths, no "..")
        if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new ArgumentException("ชื่อไฟล์ไม่ถูกต้อง");
        var f = new FileInfo(Path.Combine(InboxDir, name));
        if (!f.Exists) throw new FileNotFoundException("ไม่พบไฟล์ " + name);
        if (f.Length > MaxFile) throw new InvalidOperationException("ไฟล์ใหญ่เกิน 10 MB");
        return new { name = f.Name, size = f.Length, base64 = Convert.ToBase64String(File.ReadAllBytes(f.FullName)) };
    }
}
