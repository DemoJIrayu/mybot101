using System.IO;
using System.Windows;

namespace BotAdmin;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--selftest"))
        {
            using var o = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true };
            return Monitor.SelfTest(o).GetAwaiter().GetResult();
        }
        // --devtools-port N: expose Chrome DevTools Protocol on 127.0.0.1:N for tests/*.mjs only
        int port = Array.IndexOf(args, "--devtools-port") is var i and >= 0 && i + 1 < args.Length ? int.Parse(args[i + 1]) : 0;
        return new Application().Run(new MainWindow(port));
    }
}
