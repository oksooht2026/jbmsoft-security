// OksooHttpFix.cs — HTTP 사이트 긴급 복구 EXE (관리자 권한)
// 빌드: build.bat
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OksooHttpFix
{
    static class Program
    {
        [DllImport("wininet.dll", SetLastError = true)]
        private static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);

        private const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
        private const int INTERNET_OPTION_REFRESH = 37;

        private static readonly string MarkerDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "OksooSecurity");
        private static readonly string MarkerPath = Path.Combine(MarkerDir, "http-fix-autostart-disabled.json");

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DialogResult confirm = MessageBox.Show(
                "OKSOOHT HTTP 사이트 긴급 복구\n\n" +
                "다음을 수행합니다.\n" +
                "  · Windows 프록시 끄기\n" +
                "  · OksooSecurity 종료\n" +
                "  · 자동실행 임시 끄기\n\n" +
                "계속하시겠습니까?",
                "OKSOOHT HTTP Fix",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Question);

            if (confirm != DialogResult.OK) return;

            try
            {
                string log = RunFix();
                MessageBox.Show(
                    "복구 완료\n\n" + log +
                    "\n\n다음 단계:\n" +
                    "1) 브라우저를 모두 종료 후 다시 실행\n" +
                    "2) http://glos.co.kr 등 HTTP 사이트 확인\n\n" +
                    "재부팅해도 HTTP는 유지됩니다.\n" +
                    "(보안 자동실행을 임시로 껐습니다)",
                    "복구 완료",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "오류가 발생했습니다.\n\n" + ex.Message,
                    "오류",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        static string RunFix()
        {
            StringBuilder sb = new StringBuilder();

            DisableSystemProxy();
            sb.AppendLine("[OK] Windows 시스템 프록시 해제");

            int killed = StopOksooProcesses();
            sb.AppendLine("[OK] OksooSecurity 종료: " + killed + "개 프로세스");

            DisableSystemProxy();
            sb.AppendLine("[OK] 프록시 재확인 완료");

            string auto = DisableAutostart();
            sb.AppendLine(auto);

            int fw = RemoveMailFirewallRules();
            sb.AppendLine("[OK] 메일 방화벽 규칙 정리: " + fw + "개");

            return sb.ToString().TrimEnd();
        }

        static void DisableSystemProxy()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true))
            {
                if (key != null)
                {
                    key.SetValue("ProxyEnable", 0, RegistryValueKind.DWord);
                    try { key.DeleteValue("ProxyServer", false); } catch { }
                    key.SetValue("ProxyOverride", "localhost;127.0.0.1;<local>", RegistryValueKind.String);
                }
            }

            RunHidden("netsh", "winhttp reset proxy");
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
        }

        static int StopOksooProcesses()
        {
            int count = 0;
            try
            {
                foreach (Process p in Process.GetProcessesByName("OksooSecurity"))
                {
                    try { p.Kill(); count++; } catch { }
                }
            }
            catch { }

            try
            {
                foreach (Process p in Process.GetProcesses())
                {
                    try
                    {
                        if (!string.Equals(p.ProcessName, "electron", StringComparison.OrdinalIgnoreCase))
                            continue;
                        string path = null;
                        try { path = p.MainModule.FileName; } catch { continue; }
                        if (path == null) continue;
                        if (path.IndexOf("OksooSecurity", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            path.IndexOf("oksoo-security", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            p.Kill();
                            count++;
                        }
                    }
                    catch { }
                }
            }
            catch { }

            RunHidden("cmd.exe", "/c wmic process where \"name='OksooSecurity.exe'\" call terminate");
            System.Threading.Thread.Sleep(1000);
            return count;
        }

        static string DisableAutostart()
        {
            StringBuilder sb = new StringBuilder();
            List<string> disabledTasks = new List<string>();
            List<string> runLines = new List<string>();

            string[] taskNames = new string[] { "OksooSecurityStartupTask", "OksooSecurity", "oksoo-security" };
            foreach (string tn in taskNames)
            {
                int q = RunHidden("schtasks", "/Query /TN \"" + tn + "\"");
                if (q != 0) continue;
                int c = RunHidden("schtasks", "/Change /TN \"" + tn + "\" /DISABLE");
                if (c == 0)
                {
                    disabledTasks.Add(tn);
                    sb.AppendLine("[OK] 자동실행 끔: " + tn);
                }
            }

            DisableRunKey(Registry.CurrentUser,
                @"Software\Microsoft\Windows\CurrentVersion\Run", runLines, sb);
            try
            {
                DisableRunKey(Registry.LocalMachine,
                    @"Software\Microsoft\Windows\CurrentVersion\Run", runLines, sb);
            }
            catch { }
            try
            {
                DisableRunKey(Registry.LocalMachine,
                    @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", runLines, sb);
            }
            catch { }

            if (!Directory.Exists(MarkerDir)) Directory.CreateDirectory(MarkerDir);
            string json = BuildMarkerJson(disabledTasks, runLines);
            File.WriteAllText(MarkerPath, json, new UTF8Encoding(true));
            sb.AppendLine("[OK] 복구 정보 저장");

            if (disabledTasks.Count == 0 && runLines.Count == 0)
                sb.AppendLine("[!] 자동실행 항목을 찾지 못함 (이미 꺼졌을 수 있음)");

            return sb.ToString().TrimEnd();
        }

        static void DisableRunKey(RegistryKey root, string subPath, List<string> runLines, StringBuilder sb)
        {
            using (RegistryKey key = root.OpenSubKey(subPath, true))
            {
                if (key == null) return;
                string hive = (root == Registry.CurrentUser) ? "HKEY_CURRENT_USER" : "HKEY_LOCAL_MACHINE";
                string[] names = key.GetValueNames();
                foreach (string name in names)
                {
                    if (name.IndexOf("Oksoo", StringComparison.OrdinalIgnoreCase) < 0 &&
                        name.IndexOf("oksoo", StringComparison.OrdinalIgnoreCase) < 0 &&
                        name.IndexOf("JBMSOFT", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;
                    object val = key.GetValue(name);
                    string s = val == null ? "" : val.ToString();
                    runLines.Add(hive + "\\" + subPath + "\t" + name + "\t" + s);
                    try { key.DeleteValue(name, false); } catch { }
                    sb.AppendLine("[OK] Run 키 제거: " + name);
                }
            }
        }

        static string BuildMarkerJson(List<string> tasks, List<string> runLines)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"disabledAt\": \"" + DateTime.Now.ToString("o") + "\",\n");
            sb.Append("  \"tasks\": [");
            for (int i = 0; i < tasks.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append("\"" + EscapeJson(tasks[i]) + "\"");
            }
            sb.Append("],\n");
            sb.Append("  \"runKeys\": [");
            for (int i = 0; i < runLines.Count; i++)
            {
                string[] parts = runLines[i].Split(new char[] { '\t' });
                if (parts.Length < 3) continue;
                if (i > 0) sb.Append(", ");
                sb.Append("{\"path\":\"" + EscapeJson(parts[0]) + "\",\"name\":\"" + EscapeJson(parts[1]) + "\",\"value\":\"" + EscapeJson(parts[2]) + "\"}");
            }
            sb.Append("]\n}");
            return sb.ToString();
        }

        static string EscapeJson(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        static int RemoveMailFirewallRules()
        {
            int n = 0;
            if (RunHidden("netsh", "advfirewall firewall delete rule name=\"OKSOOHT-MailGuard-Block\"") == 0)
                n++;

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "netsh";
            psi.Arguments = "advfirewall firewall show rule name=all";
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            try
            {
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(15000);
                    string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        string t = line.Trim();
                        if (t.StartsWith("Rule Name:", StringComparison.OrdinalIgnoreCase) ||
                            t.StartsWith("규칙 이름:", StringComparison.OrdinalIgnoreCase))
                        {
                            int idx = t.IndexOf(':');
                            if (idx < 0) continue;
                            string rn = t.Substring(idx + 1).Trim();
                            if (rn.StartsWith("OKSOOHT-MailGuard-", StringComparison.OrdinalIgnoreCase))
                            {
                                RunHidden("netsh", "advfirewall firewall delete rule name=\"" + rn + "\"");
                                n++;
                            }
                        }
                    }
                }
            }
            catch { }
            return n;
        }

        static int RunHidden(string fileName, string arguments)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = fileName;
                psi.Arguments = arguments;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    p.StandardOutput.ReadToEnd();
                    p.StandardError.ReadToEnd();
                    p.WaitForExit(20000);
                    return p.ExitCode;
                }
            }
            catch
            {
                return -1;
            }
        }
    }
}
