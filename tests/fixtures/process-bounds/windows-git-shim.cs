using System;
using System.Diagnostics;
public class GitShim {
  public static int Main(string[] args) {
    var info = new ProcessStartInfo();
    info.FileName = Environment.GetEnvironmentVariable("PB_NODE");
    info.UseShellExecute = false;
    info.Arguments = "\"" + Environment.GetEnvironmentVariable("PB_GIT_SCRIPT") + "\"";
    foreach (string arg in args) info.Arguments += " \"" + arg.Replace("\"", "\\\"") + "\"";
    var child = Process.Start(info);
    if (!child.WaitForExit(16000)) { child.Kill(); return 92; }
    return child.ExitCode;
  }
}
