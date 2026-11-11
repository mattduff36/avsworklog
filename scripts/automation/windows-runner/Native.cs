using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Squires.WindowsRunner
{
    internal static class Native
    {
        internal const uint TOKEN_ALL_ACCESS = 0xF01FF;
        internal const uint CREATE_SUSPENDED = 4, CREATE_UNICODE_ENVIRONMENT = 0x400;
        internal const uint STARTF_USESTDHANDLES = 0x100, HANDLE_FLAG_INHERIT = 1;
        internal delegate bool ConsoleHandler(uint signal);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetConsoleCtrlHandler(ConsoleHandler handler, bool add);
        [DllImport("kernel32.dll")] internal static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateWindowStation(string name, uint flags, uint access, ref SecurityAttributes attributes);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr GetProcessWindowStation();
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool SetProcessWindowStation(IntPtr station);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, ref SecurityAttributes attributes);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool CloseWindowStation(IntPtr station);
        [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int info, IntPtr data, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(IntPtr job, int info, out Accounting data, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool WriteFile(IntPtr handle, byte[] bytes, uint size, out uint written, IntPtr overlapped);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableCount, SidAndAttributes[] disable, uint deleteCount, IntPtr delete, uint restrictCount, IntPtr restrict, out IntPtr restricted);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool SetTokenInformation(IntPtr token, int info, IntPtr data, uint size);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool GetTokenInformation(IntPtr token, int info, IntPtr data, uint size, out uint needed);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool LookupPrivilegeValue(string system, string name, out long luid);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokenPrivileges privileges, uint size, IntPtr old, IntPtr returned);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool LoadUserProfile(IntPtr token, ref ProfileInfo profile);
        [DllImport("userenv.dll", SetLastError = true)] internal static extern bool UnloadUserProfile(IntPtr token, IntPtr profile);
        [DllImport("userenv.dll", SetLastError = true)] internal static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
        [DllImport("userenv.dll")] internal static extern bool DestroyEnvironmentBlock(IntPtr environment);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint instances, uint output, uint input, uint timeout, ref SecurityAttributes attributes);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint pid);

        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool Inherit; }
        [StructLayout(LayoutKind.Sequential)] internal struct SidAndAttributes { internal IntPtr Sid; internal uint Attributes; }
        [StructLayout(LayoutKind.Sequential, Pack = 4)] internal struct TokenPrivileges { internal uint Count; internal long Luid; internal uint Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimit { internal long ProcessTime, JobTime; internal uint Flags; internal UIntPtr Min, Max; internal uint Active; internal UIntPtr Affinity; internal uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimit { internal BasicLimit Basic; internal IoCounters Io; internal UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
        [StructLayout(LayoutKind.Sequential)] internal struct Accounting { internal long User, Kernel, PeriodUser, PeriodKernel; internal uint Faults, Total, Active, Terminated; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo { internal uint Size; internal string Reserved, Desktop, Title; internal uint X, Y, Width, Height, XCount, YCount, Fill, Flags; internal ushort Show, ReservedSize; internal IntPtr ReservedBytes, Input, Output, Error; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfoEx { internal StartupInfo Startup; internal IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { internal IntPtr Process, Thread; internal uint Pid, Tid; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct ProfileInfo { internal int Size, Flags; internal string UserName, ProfilePath, DefaultPath, Server, Policy; internal IntPtr Profile; }

        internal static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetKernelObjectSecurity(IntPtr handle, uint info, byte[] descriptor, uint length, out uint needed);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetKernelObjectSecurity(IntPtr handle, uint info, byte[] descriptor);
        internal static void AllowOwnerImageQuery(string sid)
        {
            // The SCM token's default process DACL is tied to its service logon session.
            // Add only PROCESS_QUERY_LIMITED_INFORMATION for the paired owner so an
            // ordinary desktop client can verify the pipe server's fixed image path.
            if (WindowsIdentity.GetCurrent().User.Value != sid) throw new InvalidOperationException("Process owner mismatch");
            uint needed; GetKernelObjectSecurity(GetCurrentProcess(), 4, null, 0, out needed);
            if (needed == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            byte[] bytes = new byte[needed]; Check(GetKernelObjectSecurity(GetCurrentProcess(), 4, bytes, needed, out needed));
            var security = new RawSecurityDescriptor(bytes, 0);
            if (security.DiscretionaryAcl == null) throw new InvalidOperationException("Unrestricted process DACL refused");
            security.DiscretionaryAcl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x1000, new SecurityIdentifier(sid), false, null));
            bytes = new byte[security.BinaryLength]; security.GetBinaryForm(bytes, 0);
            Check(SetKernelObjectSecurity(GetCurrentProcess(), 4, bytes));
        }
        internal static string ImagePath(uint pid)
        {
            IntPtr process = OpenProcess(0x1000, false, pid);
            if (process == IntPtr.Zero)
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 87) return null;
                throw new Win32Exception(error);
            }
            try
            {
                uint size = 32768; var name = new StringBuilder((int)size);
                Check(QueryFullProcessImageName(process, 0, name, ref size));
                return name.ToString();
            }
            finally { CloseHandle(process); }
        }
        internal static void Ordinary(string path)
        {
            string full = Path.GetFullPath(path);
            if (!String.Equals(full, path, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Noncanonical path");
            for (string p = full; !String.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
                if ((File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked path refused");
        }
        internal static void EnablePrivilege(IntPtr token, string name)
        {
            long luid; Check(LookupPrivilegeValue(null, name, out luid));
            var p = new TokenPrivileges { Count = 1, Luid = luid, Attributes = 2 };
            Check(AdjustTokenPrivileges(token, false, ref p, 0, IntPtr.Zero, IntPtr.Zero));
            if (Marshal.GetLastWin32Error() != 0) throw new InvalidOperationException("Required host privilege unavailable");
        }
        internal static IntPtr ReducedToken(IntPtr token)
        {
            IntPtr admin = Marshal.AllocHGlobal(68), reduced = IntPtr.Zero, label = IntPtr.Zero;
            try
            {
                new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).GetBinaryFormBytes(admin);
                Check(CreateRestrictedToken(token, 1 | 4, 1, new[] { new SidAndAttributes { Sid = admin } }, 0, IntPtr.Zero, 0, IntPtr.Zero, out reduced));
                // SCM defaults grant Administrators full access but its logon SID only
                // read/execute. Once Administrators is deny-only, a child cannot manage
                // its own newly created process/thread objects. Change only this copy.
                using (var identity = new WindowsIdentity(reduced))
                {
                    var acl = ServiceDesktop.Security(identity.User.Value).DiscretionaryAcl;
                    var aclBytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(aclBytes, 0);
                    IntPtr data = Marshal.AllocHGlobal(IntPtr.Size + aclBytes.Length);
                    try
                    {
                        IntPtr aclPointer = IntPtr.Add(data, IntPtr.Size);
                        Marshal.Copy(aclBytes, 0, aclPointer, aclBytes.Length); Marshal.WriteIntPtr(data, aclPointer);
                        Check(SetTokenInformation(reduced, 6, data, (uint)IntPtr.Size));
                        VerifyDefaultDacl(reduced, identity.User.Value);
                    }
                    finally { Marshal.FreeHGlobal(data); }
                }
                var medium = new SecurityIdentifier("S-1-16-8192");
                byte[] bytes = new byte[medium.BinaryLength]; medium.GetBinaryForm(bytes, 0);
                label = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAndAttributes)) + bytes.Length);
                IntPtr sid = IntPtr.Add(label, Marshal.SizeOf(typeof(SidAndAttributes)));
                Marshal.Copy(bytes, 0, sid, bytes.Length);
                Marshal.StructureToPtr(new SidAndAttributes { Sid = sid, Attributes = 0x20 }, label, false);
                Check(SetTokenInformation(reduced, 25, label, (uint)(Marshal.SizeOf(typeof(SidAndAttributes)) + bytes.Length)));
                VerifyReduced(reduced);
                return reduced;
            }
            catch { if (reduced != IntPtr.Zero) CloseHandle(reduced); throw; }
            finally { Marshal.FreeHGlobal(admin); if (label != IntPtr.Zero) Marshal.FreeHGlobal(label); }
        }
        private static void GetBinaryFormBytes(this SecurityIdentifier sid, IntPtr pointer)
        {
            var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); Marshal.Copy(bytes, 0, pointer, bytes.Length);
        }
        internal static void VerifyDefaultDacl(IntPtr token, string owner)
        {
            uint size; GetTokenInformation(token, 6, IntPtr.Zero, 0, out size);
            if (size < IntPtr.Size) throw new InvalidOperationException("Token default ACL unavailable");
            IntPtr data = Marshal.AllocHGlobal((int)size);
            try
            {
                Check(GetTokenInformation(token, 6, data, size, out size));
                IntPtr pointer = Marshal.ReadIntPtr(data);
                if (pointer == IntPtr.Zero) throw new InvalidOperationException("Unrestricted token default ACL refused");
                var bytes = new byte[(ushort)Marshal.ReadInt16(pointer, 2)]; Marshal.Copy(pointer, bytes, 0, bytes.Length);
                var acl = new RawAcl(bytes, 0);
                if (acl.Count != 2) throw new InvalidOperationException("Unexpected token default ACL");
                bool user = false, system = false;
                foreach (GenericAce entry in acl)
                {
                    var ace = entry as CommonAce;
                    if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed || ace.AccessMask != 0x10000000 || ace.AceFlags != AceFlags.None)
                        throw new InvalidOperationException("Unexpected token default ACE");
                    if (ace.SecurityIdentifier.Value == owner) user = true;
                    else if (ace.SecurityIdentifier.Value == "S-1-5-18") system = true;
                    else throw new InvalidOperationException("Unexpected token default principal");
                }
                if (!user || !system) throw new InvalidOperationException("Missing token default principal");
            }
            finally { Marshal.FreeHGlobal(data); }
        }
        internal static void VerifyReduced(IntPtr token)
        {
            using (var identity = new WindowsIdentity(token))
                if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("Administrator child refused");
            uint size;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
            IntPtr data = Marshal.AllocHGlobal((int)size);
            try
            {
                Check(GetTokenInformation(token, 25, data, size, out size));
                var label = (SidAndAttributes)Marshal.PtrToStructure(data, typeof(SidAndAttributes));
                if (new SecurityIdentifier(label.Sid).Value != "S-1-16-8192") throw new InvalidOperationException("Medium child token required");
            }
            finally { Marshal.FreeHGlobal(data); }
            GetTokenInformation(token, 3, IntPtr.Zero, 0, out size);
            data = Marshal.AllocHGlobal((int)size);
            try
            {
                Check(GetTokenInformation(token, 3, data, size, out size));
                int count = Marshal.ReadInt32(data);
                long traverse; Check(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out traverse));
                for (int i = 0; i < count; i++)
                    if ((Marshal.ReadInt32(data, 4 + i * 12 + 8) & 2) != 0 && Marshal.ReadInt64(data, 4 + i * 12) != traverse)
                        throw new InvalidOperationException("Enabled child privilege refused");
            }
            finally { Marshal.FreeHGlobal(data); }
        }
    }

    internal sealed class ServiceDesktop : IDisposable
    {
        private IntPtr station, desktop;
        internal string Name { get; private set; }
        internal static RawSecurityDescriptor Security(string owner)
        {
            var sid = new SecurityIdentifier(owner);
            return new RawSecurityDescriptor("O:" + sid.Value + "G:" + sid.Value +
                "D:P(A;;GA;;;" + sid.Value + ")(A;;GA;;;SY)S:(ML;;NW;;;ME)");
        }
        internal ServiceDesktop(string owner)
        {
            var security = Security(owner);
            var bytes = new byte[security.BinaryLength]; security.GetBinaryForm(bytes, 0);
            IntPtr descriptor = Marshal.AllocHGlobal(bytes.Length);
            IntPtr original = Native.GetProcessWindowStation();
            if (original == IntPtr.Zero) { Marshal.FreeHGlobal(descriptor); throw new Win32Exception(); }
            try
            {
                Marshal.Copy(bytes, 0, descriptor, bytes.Length);
                var attributes = new Native.SecurityAttributes { Length = Marshal.SizeOf(typeof(Native.SecurityAttributes)), Descriptor = descriptor, Inherit = false };
                string name = "SquiresRunner_" + Guid.NewGuid().ToString("N");
                // Create-only prevents adopting any pre-existing object. Never alter WinSta0.
                station = Native.CreateWindowStation(name, 1, 0x000F037F, ref attributes);
                if (station == IntPtr.Zero) throw new Win32Exception();
                Native.Check(Native.SetProcessWindowStation(station));
                try
                {
                    desktop = Native.CreateDesktop("Runner", IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, ref attributes);
                    if (desktop == IntPtr.Zero) throw new Win32Exception();
                }
                finally { Native.Check(Native.SetProcessWindowStation(original)); }
                Name = name + "\\Runner";
            }
            catch { Dispose(); throw; }
            finally { Marshal.FreeHGlobal(descriptor); }
        }
        public void Dispose()
        {
            if (desktop != IntPtr.Zero) { Native.Check(Native.CloseDesktop(desktop)); desktop = IntPtr.Zero; }
            if (station != IntPtr.Zero) { Native.Check(Native.CloseWindowStation(station)); station = IntPtr.Zero; }
        }
    }

    internal sealed class ProcessTree : IDisposable
    {
        private readonly object gate = new object();
        private IntPtr job, process, input;
        internal uint Pid { get; private set; }
        internal ProcessTree()
        {
            job = Native.CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            var limits = new Native.ExtendedLimit { Basic = new Native.BasicLimit { Flags = 0x2000 } };
            IntPtr data = Marshal.AllocHGlobal(Marshal.SizeOf(limits));
            try { Marshal.StructureToPtr(limits, data, false); Native.Check(Native.SetInformationJobObject(job, 9, data, (uint)Marshal.SizeOf(limits))); }
            finally { Marshal.FreeHGlobal(data); }
        }
        internal StreamReader Start(string exe, string arguments, string cwd, IntPtr token, IntPtr environment, bool service, string desktop = null)
        {
            IntPtr stdin = IntPtr.Zero, stdout = IntPtr.Zero, output = IntPtr.Zero;
            IntPtr attributes = IntPtr.Zero, jobList = IntPtr.Zero, handles = IntPtr.Zero;
            bool initialized = false;
            var sa = new Native.SecurityAttributes { Length = Marshal.SizeOf(typeof(Native.SecurityAttributes)), Inherit = true };
            Native.ProcessInfo pi = new Native.ProcessInfo();
            try
            {
                Native.Check(Native.CreatePipe(out stdin, out input, ref sa, 0));
                Native.Check(Native.SetHandleInformation(input, 1, 0));
                Native.Check(Native.CreatePipe(out output, out stdout, ref sa, 0));
                Native.Check(Native.SetHandleInformation(output, 1, 0));
                IntPtr size = IntPtr.Zero;
                Native.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                attributes = Marshal.AllocHGlobal(size);
                Native.Check(Native.InitializeProcThreadAttributeList(attributes, 2, 0, ref size));
                initialized = true;
                jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
                // Atomic job membership also contains a child if the host dies during creation.
                Native.Check(Native.UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
                Marshal.WriteIntPtr(handles, stdin); Marshal.WriteIntPtr(handles, IntPtr.Size, stdout);
                Native.Check(Native.UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero));
                var si = new Native.StartupInfoEx { Startup = new Native.StartupInfo { Size = (uint)Marshal.SizeOf(typeof(Native.StartupInfoEx)), Desktop = desktop, Flags = Native.STARTF_USESTDHANDLES, Input = stdin, Output = stdout, Error = stdout }, Attributes = attributes };
                var command = new StringBuilder("\"" + exe + "\" " + arguments);
                if (service) Native.Check(Native.CreateProcessAsUser(token, exe, command, IntPtr.Zero, IntPtr.Zero, true, 4 | 0x400 | 0x80000 | 0x08000000, environment, cwd, ref si, out pi));
                else
                {
                    Native.VerifyReduced(token);
                    Native.Check(Native.CreateProcess(exe, command, IntPtr.Zero, IntPtr.Zero, true, 4 | 0x400 | 0x80000 | 0x08000000, environment, cwd, ref si, out pi));
                }
                process = pi.Process; Pid = pi.Pid;
                bool member; Native.Check(Native.IsProcessInJob(process, job, out member));
                if (!member) throw new InvalidOperationException("Atomic job assignment unavailable");
                if (Native.ResumeThread(pi.Thread) == UInt32.MaxValue) throw new Win32Exception();
                var reader = new StreamReader(new FileStream(new SafeFileHandle(output, true), FileAccess.Read, 4096, false));
                output = IntPtr.Zero;
                return reader;
            }
            catch { if (pi.Process != IntPtr.Zero) Native.TerminateProcess(pi.Process, 1); throw; }
            finally
            {
                if (pi.Thread != IntPtr.Zero) Native.CloseHandle(pi.Thread);
                if (stdin != IntPtr.Zero) Native.CloseHandle(stdin);
                if (stdout != IntPtr.Zero) Native.CloseHandle(stdout);
                if (output != IntPtr.Zero) Native.CloseHandle(output);
                if (initialized) Native.DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            }
        }
        internal bool Exited { get { return process != IntPtr.Zero && Native.WaitForSingleObject(process, 0) == 0; } }
        internal uint ExitCode { get { uint code; Native.Check(Native.GetExitCodeProcess(process, out code)); return code; } }
        internal uint Active
        {
            get { lock (gate) { if (job == IntPtr.Zero) return 0; Native.Accounting a; Native.Check(Native.QueryInformationJobObject(job, 1, out a, (uint)Marshal.SizeOf(typeof(Native.Accounting)), IntPtr.Zero)); return a.Active; } }
        }
        internal void RequestStop()
        {
            if (input == IntPtr.Zero) return;
            uint written; byte[] bytes = Encoding.ASCII.GetBytes("SQUIRES_RUNNER_STOP\n");
            if (!Native.WriteFile(input, bytes, (uint)bytes.Length, out written, IntPtr.Zero) && Marshal.GetLastWin32Error() != 109) throw new Win32Exception();
        }
        internal void Kill() { lock (gate) { if (job != IntPtr.Zero) Native.Check(Native.TerminateJobObject(job, 1)); } }
        public void Dispose()
        {
            lock (gate)
            {
                if (job != IntPtr.Zero) { Native.CloseHandle(job); job = IntPtr.Zero; }
                if (input != IntPtr.Zero) { Native.CloseHandle(input); input = IntPtr.Zero; }
                if (process != IntPtr.Zero) { Native.CloseHandle(process); process = IntPtr.Zero; }
            }
        }
    }
}
