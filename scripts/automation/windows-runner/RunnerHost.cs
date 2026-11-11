using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Squires.WindowsRunner
{
    internal sealed class Config
    {
        internal const string ServiceName = "SquiresFixerrorsRunner";
        internal const string Checkout = @"D:\Websites\avsworklog";
        internal static readonly string Package = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Squires\FixerrorsRunner");
        internal string Sid, Account, Profile, Node, Root;
        internal static JavaScriptSerializer Json { get { return new JavaScriptSerializer { MaxJsonLength = 131072, RecursionLimit = 32 }; } }
        internal static Dictionary<string, object> ReadJson(string path, int maximum)
        {
            Native.Ordinary(path);
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (stream.Length > maximum) throw new InvalidOperationException("Oversized configuration");
                using (var reader = new StreamReader(stream, new UTF8Encoding(false, true)))
                    return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
        }
        internal static bool Flag(Dictionary<string, object> data, string key)
        {
            object value;
            return data.TryGetValue(key, out value) && value is bool && (bool)value;
        }
        internal static Config Load()
        {
            string root = Path.GetDirectoryName(typeof(Config).Assembly.Location);
#if !RUNNER_FIXTURE
            if (!String.Equals(root, Package, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Install reviewed package in fixed Program Files path");
            ProtectedPackage(root);
#endif
            var data = ReadJson(Path.Combine(root, "runner.json"), 4096);
            if (data.Count != 5 || !data.ContainsKey("ownerSid") || !data.ContainsKey("ownerAccount") ||
                !data.ContainsKey("ownerProfile") || !data.ContainsKey("nodeExe") || !data.ContainsKey("version") ||
                !(data["version"] is int) || (int)data["version"] != 1) throw new InvalidOperationException("Invalid immutable configuration");
            var cfg = new Config { Sid = (string)data["ownerSid"], Account = (string)data["ownerAccount"], Profile = (string)data["ownerProfile"], Node = (string)data["nodeExe"], Root = root };
            if (new NTAccount(cfg.Account).Translate(typeof(SecurityIdentifier)).Value != cfg.Sid ||
                WindowsIdentity.GetCurrent().User.Value != cfg.Sid) throw new InvalidOperationException("Enrolled owner account required");
            Native.Ordinary(cfg.Profile); Native.Ordinary(cfg.Node);
#if !RUNNER_FIXTURE
            if (!String.Equals(Path.GetFileName(cfg.Node), "node.exe", StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(Environment.ExpandEnvironmentVariables((string)Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\" + cfg.Sid, "ProfileImagePath", "")), cfg.Profile, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Owner profile or Node path mismatch");
#endif
            return cfg;
        }
        internal static void ProtectedPackage(string root)
        {
            Native.Ordinary(root);
            foreach (string path in new[] { Path.GetDirectoryName(root), root, Path.Combine(root, "RunnerHost.exe"), Path.Combine(root, "runner.json"), Path.Combine(root, "Manager.ps1"), Path.Combine(root, "Launch.cmd") })
            {
                Native.Ordinary(path);
                var security = Directory.Exists(path) ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
                if (!security.AreAccessRulesProtected) throw new InvalidOperationException("Package ACL must be protected");
                string owner = security.GetOwner(typeof(SecurityIdentifier)).Value;
                if (owner != "S-1-5-32-544" && owner != "S-1-5-18") throw new InvalidOperationException("Package must be administrator owned");
                foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                    if (rule.AccessControlType == AccessControlType.Allow &&
                        (rule.FileSystemRights & (FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership | FileSystemRights.DeleteSubdirectoriesAndFiles)) != 0 &&
                        rule.IdentityReference.Value != "S-1-5-32-544" && rule.IdentityReference.Value != "S-1-5-18")
                        throw new InvalidOperationException("Untrusted package writer");
            }
        }
        internal string Pipe
        {
            get
            {
#if RUNNER_FIXTURE
                return "SquiresFixerrorsFixture-" + Path.GetFileName(Root);
#else
                return "SquiresFixerrorsRunner-" + Sid;
#endif
            }
        }
        internal string Data
        {
            get
            {
#if RUNNER_FIXTURE
                return Path.Combine(Root, "data");
#else
                return Path.Combine(Profile, @".codex\cursor-worker\squires-runner-manager");
#endif
            }
        }
        internal string Eligibility(string mode)
        {
#if RUNNER_FIXTURE
            if (File.Exists(Path.Combine(Root, "disabled.fixture"))) return "enrollment-disabled";
            return "eligible";
#else
            try
            {
                var data = ReadJson(Path.Combine(Profile, @".codex\cursor-worker\squires-companion\enrollment.json"), 65536);
                if (!Flag(data, "enabled") || !Flag(data, "workerEligible")) return "enrollment-disabled";
                if (!Flag(data, "allowReadOnly")) return "review-opt-out";
                if (mode != "review" && !Flag(data, "allowBoundedRepair")) return "repair-opt-out";
                if (mode == "deploy" && !Flag(data, "allowRelease")) return "deploy-opt-out";
                return "eligible";
            }
            catch (IOException) { return "enrollment-unavailable"; }
            catch (ArgumentException) { return "enrollment-invalid"; }
            catch (InvalidOperationException) { return "enrollment-invalid"; }
            catch (UnauthorizedAccessException) { return "enrollment-unavailable"; }
#endif
        }
    }

    public static class OwnerConsent
    {
        public static void Set(string mode)
        {
            var cfg = Config.Load();
            Apply(cfg, Path.Combine(cfg.Profile, @".codex\cursor-worker\squires-companion\enrollment.json"), mode);
        }
#if RUNNER_FIXTURE
        public static void SetFixture(string mode)
        {
            var cfg = Config.Load();
            Apply(cfg, Path.Combine(cfg.Root, "enrollment.json"), mode);
        }
#endif
        private static void PrivateAcl(string path, string sid, bool directory)
        {
            Native.Ordinary(path);
            var acl = directory ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
            if (acl.GetOwner(typeof(SecurityIdentifier)).Value != sid || (directory && !acl.AreAccessRulesProtected))
                throw new InvalidOperationException("Enrollment must remain owner-only");
            foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && rule.IdentityReference.Value != sid)
                    throw new InvalidOperationException("Enrollment must remain owner-only");
        }
        private static void Apply(Config cfg, string file, string mode)
        {
            if (mode != "disabled" && mode != "review" && mode != "repair" && mode != "deploy")
                throw new InvalidOperationException("Unknown consent mode");
            if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
                throw new InvalidOperationException("Standard enrolled owner required");
            var security = new MutexSecurity();
            foreach (string sid in new[] { cfg.Sid, "S-1-5-18", "S-1-5-32-544" })
                security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(sid), MutexRights.FullControl, AccessControlType.Allow));
            bool created;
            using (var mutex = new Mutex(false, @"Global\" + cfg.Pipe, out created, security))
            {
                bool held = false;
                try
                {
                    try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                    if (!held) throw new InvalidOperationException("Stop the managed host before changing consent");
                    UpdateFile(cfg, file, mode);
                }
                finally { if (held) mutex.ReleaseMutex(); }
            }
        }
        private static void UpdateFile(Config cfg, string file, string mode)
        {
#if !RUNNER_FIXTURE
            if (File.Exists(Path.Combine(Config.Checkout, @".git\squires-fixerrors-companion.lock")))
                throw new InvalidOperationException("Reconcile the companion lock before changing consent");
#endif
            string directory = Path.GetDirectoryName(file);
            PrivateAcl(directory, cfg.Sid, true); PrivateAcl(file, cfg.Sid, false);
            var data = Config.ReadJson(file, 65536);
            string original = File.ReadAllText(file, new UTF8Encoding(false, true));
            string[] flags = { "enabled", "workerEligible", "allowReadOnly", "allowBoundedRepair", "allowRelease" };
            foreach (string flag in flags)
                if (!data.ContainsKey(flag) || !(data[flag] is bool)) throw new InvalidOperationException("Invalid enrollment consent");
            data["enabled"] = mode != "disabled"; data["workerEligible"] = mode != "disabled";
            data["allowReadOnly"] = mode != "disabled"; data["allowBoundedRepair"] = mode == "repair" || mode == "deploy";
            data["allowRelease"] = mode == "deploy";
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(Config.Json.Serialize(data));
            if (bytes.Length > 65536) throw new InvalidOperationException("Enrollment size refused");
            string pending = Path.Combine(directory, "consent-" + Guid.NewGuid().ToString("N") + ".pending");
            using (var stream = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
            }
            File.SetAccessControl(pending, File.GetAccessControl(file));
            PrivateAcl(file, cfg.Sid, false);
            if (File.ReadAllText(file, new UTF8Encoding(false, true)) != original)
                throw new InvalidOperationException("Enrollment changed; pending consent retained for investigation");
            File.Replace(pending, file, null);
            PrivateAcl(file, cfg.Sid, false);
            if (Config.Json.Serialize(Config.ReadJson(file, 65536)) != Config.Json.Serialize(data))
                throw new InvalidOperationException("Enrollment consent writeback not confirmed");
        }
    }

    internal sealed class Runner : IDisposable
    {
        private readonly Config cfg;
        private readonly string mode;
        private readonly bool service;
        private readonly ManualResetEvent stop = new ManualResetEvent(false), done = new ManualResetEvent(false);
        private ProcessTree tree;
        private Mutex singleton;
        private volatile string state = "starting";
        private long lastTelemetry;
        private IntPtr loggingToken;
        private Thread thread, pipeThread;
        private Native.ConsoleHandler consoleHandler;
        internal Runner(Config config, string selectedMode, bool scm) { cfg = config; mode = selectedMode; service = scm; }
        internal void Start()
        {
            if (service) Native.AllowOwnerImageQuery(cfg.Sid);
            var acl = new MutexSecurity();
            foreach (string sid in new[] { cfg.Sid, "S-1-5-18", "S-1-5-32-544" })
                acl.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(sid), MutexRights.FullControl, AccessControlType.Allow));
            bool created;
            singleton = new Mutex(false, @"Global\" + cfg.Pipe, out created, acl);
            // Mutex ownership is held and released by this same lifecycle thread.
            thread = new Thread(Run) { IsBackground = false };
            thread.Start();
            if (!started.WaitOne(15000)) { Stop(); throw new InvalidOperationException("Host startup timed out"); }
            if (startFailure != null) { Stop(); throw new InvalidOperationException(startFailure); }
        }
        private readonly ManualResetEvent started = new ManualResetEvent(false);
        private string startFailure;
        internal void Wait() { if (thread != null) thread.Join(); }
        internal bool CloseConsole(uint signal)
        {
            if (signal != 0 && signal != 1 && signal != 2 && signal != 5 && signal != 6) return false;
            try
            {
#if RUNNER_FIXTURE
                File.AppendAllText(Path.Combine(cfg.Root, "signals.txt"), signal.ToString() + Environment.NewLine);
#endif
                stop.Set();
                if (!done.WaitOne(signal == 0 || signal == 1 ? 6500 : 1000))
                {
                    var current = tree;
                    if (current != null) current.Kill();
                    done.WaitOne(2000);
                }
                return true;
            }
            catch (Exception)
            {
                Program.Failed = true;
                Console.Error.WriteLine("Console shutdown not confirmed; owner reconciliation required");
                return false;
            }
        }
        internal void AttachConsole()
        {
            consoleHandler = CloseConsole;
            Native.Check(Native.SetConsoleCtrlHandler(consoleHandler, true));
        }
        internal void Stop()
        {
            stop.Set();
            if (!done.WaitOne(12000)) throw new InvalidOperationException("Stop not confirmed; owner reconciliation required");
        }
        private void Log(string code)
        {
            // Only fixed lifecycle codes are persisted. Never forward child output/errors.
            using (var impersonation = loggingToken == IntPtr.Zero ? null : WindowsIdentity.Impersonate(loggingToken))
            {
                string file = Path.Combine(cfg.Data, "runner.log");
                if (File.Exists(file)) Native.Ordinary(file);
                File.AppendAllText(file, DateTime.UtcNow.ToString("O") + " " + code + Environment.NewLine);
            }
        }
        private void Run()
        {
            bool held = false;
            IntPtr token = IntPtr.Zero, reduced = IntPtr.Zero, environment = IntPtr.Zero;
            Native.ProfileInfo profile = new Native.ProfileInfo();
            try
            {
                try { held = singleton.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                if (!held) throw new InvalidOperationException("Another console or service host is running");
                Native.Ordinary(cfg.Data);
                ValidatePrivateData(cfg.Data, cfg.Sid);
                if (service)
                {
                    Native.Check(Native.OpenProcessToken(Native.GetCurrentProcess(), Native.TOKEN_ALL_ACCESS, out token));
                    Native.EnablePrivilege(token, "SeBackupPrivilege"); Native.EnablePrivilege(token, "SeRestorePrivilege");
                    profile.Size = Marshal.SizeOf(typeof(Native.ProfileInfo)); profile.Flags = 1; profile.UserName = cfg.Account.Substring(cfg.Account.IndexOf('\\') + 1);
                    Native.Check(Native.LoadUserProfile(token, ref profile));
                    reduced = Native.ReducedToken(token);
                    loggingToken = reduced;
                }
                else
                {
                    Native.Check(Native.OpenProcessToken(Native.GetCurrentProcess(), 8 | 2, out token));
                    Native.VerifyReduced(token);
                }
                environment = EnvironmentBlock(service ? reduced : token);
                pipeThread = new Thread(PipeLoop) { IsBackground = true }; pipeThread.Start();
                state = "idle-" + cfg.Eligibility(mode);
                Log(service ? "service-started" : "console-started");
#if RUNNER_FIXTURE
                File.WriteAllText(Path.Combine(cfg.Root, "window.txt"), Native.GetConsoleWindow().ToInt64().ToString());
#endif
                started.Set();
                while (!stop.WaitOne(250))
                {
                    string eligibility = cfg.Eligibility(mode);
                    if (tree == null)
                    {
                        state = "idle-" + eligibility;
                        if (eligibility != "eligible") continue;
                        tree = new ProcessTree();
#if RUNNER_FIXTURE
                        var output = tree.Start(typeof(Runner).Assembly.Location, "fixture-child", cfg.Root, token, environment, service);
#else
                        var output = tree.Start(cfg.Node, "--import=tsx scripts\\automation\\fixerrors-companion.ts", Config.Checkout, service ? reduced : token, environment, service);
#endif
                        state = "running-starting";
                        new Thread(() => ReadOutput(output)) { IsBackground = true }.Start();
                    }
                    else
                    {
                        if (eligibility != "eligible") { state = "stopping-opt-out"; stop.Set(); }
                        if (tree.Exited) { state = "child-exited-owner-review"; Log("child-exited-owner-review"); Program.Failed = true; stop.Set(); }
                    }
                }
                if (tree != null)
                {
                    tree.RequestStop();
                    var until = DateTime.UtcNow.AddSeconds(5);
                    while (tree.Active != 0 && DateTime.UtcNow < until) Thread.Sleep(50);
                    if (tree.Active != 0) tree.Kill();
                    until = DateTime.UtcNow.AddSeconds(3);
                    while (tree.Active != 0 && DateTime.UtcNow < until) Thread.Sleep(25);
                    if (tree.Active != 0) throw new InvalidOperationException("Tree termination not confirmed");
                }
                state = "stopped"; Log("tree-stop-confirmed");
            }
            catch (Exception ex)
            {
#if RUNNER_FIXTURE
                Console.Error.WriteLine(ex.ToString());
                File.AppendAllText(Path.Combine(cfg.Root, "stderr.txt"), ex.ToString());
#endif
                // Exception text can include paths or child input; return only a fixed safe code.
                startFailure = held ? "Host failed closed; inspect enrollment, profile, ACL, token and existing locks" : "Another host is running";
                state = "host-failed-" + ex.GetType().Name;
                Console.Error.WriteLine(startFailure);
                Program.Failed = true;
            }
            finally
            {
                stop.Set();
                if (tree != null) tree.Dispose();
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                loggingToken = IntPtr.Zero;
                if (reduced != IntPtr.Zero) Native.CloseHandle(reduced);
                if (profile.Profile != IntPtr.Zero && !Native.UnloadUserProfile(token, profile.Profile))
                {
                    Program.Failed = true;
                    Console.Error.WriteLine("Owner profile unload not confirmed; owner investigation required");
                }
                if (token != IntPtr.Zero) Native.CloseHandle(token);
                if (pipeThread != null) pipeThread.Join(2500);
                if (held) singleton.ReleaseMutex();
                started.Set(); done.Set();
            }
        }
        private static void ValidatePrivateData(string path, string sid)
        {
            var acl = Directory.GetAccessControl(path);
            if (!acl.AreAccessRulesProtected || acl.GetOwner(typeof(SecurityIdentifier)).Value != sid) throw new InvalidOperationException("Owner-only data ACL required");
            foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && rule.IdentityReference.Value != sid) throw new InvalidOperationException("Owner-only data ACL required");
        }
        private IntPtr EnvironmentBlock(IntPtr token)
        {
            IntPtr source;
            Native.Check(Native.CreateEnvironmentBlock(out source, token, false));
            var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                for (IntPtr p = source; Marshal.ReadInt16(p) != 0; )
                {
                    string entry = Marshal.PtrToStringUni(p); p = IntPtr.Add(p, (entry.Length + 1) * 2);
                    int equals = entry.IndexOf('=');
                    if (equals > 0) values[entry.Substring(0, equals)] = entry.Substring(equals + 1);
                }
            }
            finally { Native.DestroyEnvironmentBlock(source); }
            var allowed = new HashSet<string>(new[] { "SystemRoot", "SystemDrive", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "ALLUSERSPROFILE", "PUBLIC", "HOMEDRIVE", "HOMEPATH", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "USERNAME", "USERDOMAIN" }, StringComparer.OrdinalIgnoreCase);
            var filtered = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in values) if (allowed.Contains(pair.Key)) filtered[pair.Key] = pair.Value;
            if (!filtered.ContainsKey("USERPROFILE") || !String.Equals(filtered["USERPROFILE"], cfg.Profile, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SCM owner profile unavailable");
            filtered["PATH"] = Path.GetDirectoryName(cfg.Node) + @";C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Program Files\Git\cmd";
            filtered["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";
            filtered["PSModulePath"] = Path.Combine(cfg.Profile, @"Documents\WindowsPowerShell\Modules") + @";C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules";
            filtered["SQUIRES_FIXERRORS_COMPANION_ENABLED"] = "1";
            filtered["SQUIRES_FIXERRORS_COMPANION_PRODUCTION"] = "1";
            filtered["SQUIRES_FIXERRORS_ALLOW_READ_ONLY"] = "1";
            if (mode != "review") filtered["SQUIRES_FIXERRORS_ALLOW_REPAIR"] = "1";
            if (mode == "deploy") filtered["SQUIRES_FIXERRORS_ALLOW_DEPLOY"] = "1";
            filtered["SQUIRES_FIXERRORS_MANAGED_STDIN"] = "1";
            var text = new StringBuilder();
            foreach (var pair in filtered) text.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
            text.Append('\0');
            return Marshal.StringToHGlobalUni(text.ToString());
        }
        private void ReadOutput(StreamReader reader)
        {
            using (reader)
            {
                try
                {
                    // Bound each line without ever buffering arbitrary child output.
                    var line = new StringBuilder(); int c;
                    while ((c = reader.Read()) >= 0)
                    {
                        if (c == '\n')
                        {
                            string text = line.ToString().TrimEnd('\r');
                            if (text == "SQUIRES_RUNNER_STATE:ready" || text == "SQUIRES_RUNNER_STATE:waiting" || text == "SQUIRES_RUNNER_STATE:packet-blocked" || text == "SQUIRES_RUNNER_STATE:bridge-blocked" ||
                                text == "SQUIRES_RUNNER_STATE:polling" || text == "SQUIRES_RUNNER_STATE:active" || text == "SQUIRES_RUNNER_STATE:stopping")
                            {
                                Interlocked.Exchange(ref lastTelemetry, Stopwatch.GetTimestamp());
                                state = "running-" + text.Substring("SQUIRES_RUNNER_STATE:".Length);
                            }
                            line.Length = 0;
                        }
                        else if (line.Length < 256) line.Append((char)c);
                    }
                }
                catch (IOException) { stop.Set(); }
            }
        }
        private void PipeLoop()
        {
            try
            {
                while (!stop.WaitOne(0))
                {
                    var acl = new PipeSecurity(); acl.SetAccessRuleProtection(true, false);
                    foreach (string sid in new[] { cfg.Sid, "S-1-5-18", "S-1-5-32-544" })
                        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.FullControl, AccessControlType.Allow));
                    byte[] bytes = acl.GetSecurityDescriptorBinaryForm(); IntPtr sd = Marshal.AllocHGlobal(bytes.Length);
                    SafePipeHandleHolder holder = null;
                    try
                    {
                        Marshal.Copy(bytes, 0, sd, bytes.Length);
                        var sa = new Native.SecurityAttributes { Length = Marshal.SizeOf(typeof(Native.SecurityAttributes)), Descriptor = sd };
                        var handle = Native.CreateNamedPipe(@"\\.\pipe\" + cfg.Pipe, 3 | 0x40000000 | 0x80000, 8, 1, 2048, 64, 0, ref sa);
                        holder = new SafePipeHandleHolder(handle);
                        if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception();
                        using (var pipe = new NamedPipeServerStream(PipeDirection.InOut, true, false, handle))
                        {
                            holder = null;
                            var connect = pipe.BeginWaitForConnection(null, null);
                            while (!connect.AsyncWaitHandle.WaitOne(100)) if (stop.WaitOne(0)) return;
                            pipe.EndWaitForConnection(connect);
                            string peer = pipe.GetImpersonationUserName();
                            string sid = new NTAccount(peer).Translate(typeof(SecurityIdentifier)).Value;
                            if (sid != cfg.Sid && sid != "S-1-5-18") continue;
                            byte[] command = new byte[16]; var read = pipe.BeginRead(command, 0, command.Length, null, null);
                            if (!read.AsyncWaitHandle.WaitOne(1000)) continue;
                            int count = pipe.EndRead(read);
                            string request = Encoding.ASCII.GetString(command, 0, count);
                            bool closeFixture = false;
#if RUNNER_FIXTURE
                            closeFixture = request == "close-fixture";
#endif
                            if (request != "status" && request != "stop" && !closeFixture) continue;
                            long last = Interlocked.Read(ref lastTelemetry);
                            bool fresh = last != 0 && Stopwatch.GetTimestamp() - last < Stopwatch.Frequency * 15L;
                            bool enabled = cfg.Eligibility(mode) == "eligible";
                            byte[] response = Encoding.UTF8.GetBytes(Config.Json.Serialize(new { host = service ? "service" : "console", state = state, mode = mode, enabled = enabled, running = true, ready = enabled && (state == "running-ready" || state == "running-waiting") && fresh, pid = Process.GetCurrentProcess().Id }));
                            var write = pipe.BeginWrite(response, 0, response.Length, null, null);
                            if (write.AsyncWaitHandle.WaitOne(1000)) pipe.EndWrite(write);
                            if (request == "stop") stop.Set();
#if RUNNER_FIXTURE
                            if (closeFixture) new Thread(() => CloseConsole(2)) { IsBackground = true }.Start();
#endif
                        }
                    }
                    finally { if (holder != null) holder.Dispose(); Marshal.FreeHGlobal(sd); }
                }
            }
            catch (Exception) { state = "ipc-failed"; stop.Set(); Program.Failed = true; }
        }
        private sealed class SafePipeHandleHolder : IDisposable
        {
            private readonly Microsoft.Win32.SafeHandles.SafePipeHandle handle;
            internal SafePipeHandleHolder(Microsoft.Win32.SafeHandles.SafePipeHandle value) { handle = value; }
            public void Dispose() { handle.Dispose(); }
        }
        public void Dispose()
        {
            Stop();
            if (consoleHandler != null) { Native.Check(Native.SetConsoleCtrlHandler(consoleHandler, false)); consoleHandler = null; }
            if (singleton != null) singleton.Dispose();
            stop.Dispose(); done.Dispose(); started.Dispose();
        }
    }

    internal sealed class RunnerService : ServiceBase
    {
        private Runner runner;
        private readonly object gate = new object();
        internal RunnerService() { ServiceName = Config.ServiceName; CanStop = true; CanShutdown = true; AutoLog = false; }
        protected override void OnStart(string[] args)
        {
            string mode = Program.Mode(args.Length == 0 ? new[] { "review" } : args);
            var config = Config.Load();
            if (!ServiceInstall.Validate(config.Root, config.Account)) throw new InvalidOperationException("Known manual service required");
            var current = new Runner(config, mode, true);
            lock (gate) { runner = current; current.Start(); }
            new Thread(() => { current.Wait(); if (Program.Failed) ExitCode = 1; Stop(); }) { IsBackground = true }.Start();
        }
        private void StopCore(bool extend)
        {
            lock (gate)
            {
                if (runner == null) return;
                if (extend) RequestAdditionalTime(15000);
                runner.Dispose(); runner = null;
            }
        }
        protected override void OnStop() { StopCore(true); }
        protected override void OnShutdown() { StopCore(false); }
    }

    public static class Program
    {
        internal static bool Failed;
        internal static string Mode(string[] args)
        {
            if (args.Length != 1 || (args[0] != "review" && args[0] != "repair" && args[0] != "deploy")) throw new InvalidOperationException("Explicit review, repair or deploy mode required");
            return args[0];
        }
        public static int Main(string[] args)
        {
            try
            {
#if RUNNER_FIXTURE
                if (args.Length == 1 && args[0] == "fixture-child")
                {
                    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "child.txt"), Process.GetCurrentProcess().Id.ToString());
                    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "environment.json"), Config.Json.Serialize(new {
                        profile = Environment.GetEnvironmentVariable("USERPROFILE"),
                        drive = Environment.GetEnvironmentVariable("SystemDrive"),
                        path = Environment.GetEnvironmentVariable("PATH"),
                        inheritedUnsafe = Environment.GetEnvironmentVariable("NODE_OPTIONS") != null || Environment.GetEnvironmentVariable("CODEX_THREAD_ID") != null
                    }));
                    Process.Start(new ProcessStartInfo(typeof(Program).Assembly.Location, "fixture-grandchild") { UseShellExecute = false, CreateNoWindow = true });
                    Console.WriteLine("Authorization: synthetic-fixture-not-a-secret");
                    Console.WriteLine(File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "waiting.fixture"))
                        ? "SQUIRES_RUNNER_STATE:waiting" : "SQUIRES_RUNNER_STATE:ready");
                    Thread.Sleep(Timeout.Infinite); return 0;
                }
                if (args.Length == 1 && args[0] == "fixture-grandchild")
                {
                    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "grandchild.txt"), Process.GetCurrentProcess().Id.ToString());
                    Thread.Sleep(Timeout.Infinite); return 0;
                }
                if (args.Length == 1 && args[0] == "--fixture-token")
                {
                    IntPtr token, reduced = IntPtr.Zero;
                    if (Marshal.OffsetOf(typeof(Native.TokenPrivileges), "Luid").ToInt32() != 4) throw new InvalidOperationException("Invalid native privilege layout");
                    Native.Check(Native.OpenProcessToken(Native.GetCurrentProcess(), Native.TOKEN_ALL_ACCESS, out token));
                    try { reduced = Native.ReducedToken(token); Console.WriteLine("restricted-medium-nonadmin"); }
                    finally { if (reduced != IntPtr.Zero) Native.CloseHandle(reduced); Native.CloseHandle(token); }
                    return 0;
                }
                if (args.Length == 2 && args[0] == "--fixture-consent")
                {
                    OwnerConsent.SetFixture(args[1]); return 0;
                }
#endif
                if (args.Length == 1 && args[0] == "--service") { ServiceBase.Run(new RunnerService()); return Failed ? 1 : 0; }
                var cfg = Config.Load();
#if RUNNER_FIXTURE
                if (args.Length == 1 && args[0] == "--fixture-close") return Client(cfg, "close-fixture");
#endif
                if (args.Length == 1 && args[0] == "--service-check")
                    return ServiceInstall.Validate(cfg.Root, cfg.Account) ? 0 : 2;
                if (args.Length == 2 && args[0] == "--console")
                {
                    using (var runner = new Runner(cfg, Mode(new[] { args[1] }), false))
                    { runner.AttachConsole(); runner.Start(); Console.WriteLine("MPDEE Worker host running; closing this terminal stops its process tree."); runner.Wait(); }
                    return Failed ? 1 : 0;
                }
                if (args.Length == 1 && (args[0] == "--status" || args[0] == "--stop"))
                    return Client(cfg, args[0] == "--stop" ? "stop" : "status");
                throw new InvalidOperationException("Unknown operation");
            }
            catch (Exception)
            {
                Console.Error.WriteLine("Runner operation not confirmed. Investigate before retry; evidence and existing locks were not automatically cleared.");
                return 1;
            }
        }
        private static int Client(Config cfg, string command)
        {
            using (var pipe = new NamedPipeClientStream(".", cfg.Pipe, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification))
            {
                try { pipe.Connect(1000); }
                catch (System.TimeoutException)
                {
                    foreach (var candidate in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(typeof(Program).Assembly.Location)))
                    {
                        using (candidate)
                        {
                            if (candidate.Id == Process.GetCurrentProcess().Id) continue;
                            if (String.Equals(Native.ImagePath((uint)candidate.Id), typeof(Program).Assembly.Location, StringComparison.OrdinalIgnoreCase))
                            {
                                Console.WriteLine("{\"running\":true,\"ready\":false,\"host\":\"unknown\",\"state\":\"host-unresponsive-owner-review\"}");
                                return command == "status" ? 0 : 2;
                            }
                        }
                    }
                    Console.WriteLine("{\"running\":false,\"ready\":false,\"state\":\"no-managed-host\"}");
                    return command == "status" ? 0 : 2;
                }
                uint pid; Native.Check(Native.GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid));
                if (!String.Equals(Native.ImagePath(pid), typeof(Program).Assembly.Location, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Unknown IPC server");
                byte[] request = Encoding.ASCII.GetBytes(command);
                pipe.Write(request, 0, request.Length);
                byte[] response = new byte[2048]; var read = pipe.BeginRead(response, 0, response.Length, null, null);
                if (!read.AsyncWaitHandle.WaitOne(2000)) throw new InvalidOperationException("IPC timeout");
                Console.WriteLine(Encoding.UTF8.GetString(response, 0, pipe.EndRead(read)));
                return 0;
            }
        }
    }
}
