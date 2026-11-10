using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Squires.WindowsRunner
{
    public static class ServiceInstall
    {
        public const string Name = "SquiresFixerrorsRunner";
        public const string Description = "Squires reviewed Windows runner v1; manual start only; enrolled owner; no automatic recovery.";
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenSCManager(string machine, string database, uint access);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenService(IntPtr scm, string name, uint access);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateService(IntPtr scm, string name, string display, uint access, uint type, uint start, uint error, string binary, string group, IntPtr tag, string dependencies, string account, IntPtr password);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CloseServiceHandle(IntPtr handle);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryServiceConfig(IntPtr service, IntPtr config, uint bytes, out uint needed);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryServiceConfig2(IntPtr service, uint level, IntPtr config, uint bytes, out uint needed);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ChangeServiceConfig2(IntPtr service, uint level, IntPtr config);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetServiceObjectSecurity(IntPtr service, uint info, byte[] descriptor);
        [DllImport("advapi32.dll")] private static extern uint LsaOpenPolicy(IntPtr system, ref ObjectAttributes attributes, uint access, out IntPtr policy);
        [DllImport("advapi32.dll")] private static extern uint LsaEnumerateAccountRights(IntPtr policy, byte[] sid, out IntPtr rights, out uint count);
        [DllImport("advapi32.dll")] private static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LsaString[] rights, uint count);
        [DllImport("advapi32.dll")] private static extern uint LsaClose(IntPtr policy);
        [DllImport("advapi32.dll")] private static extern uint LsaFreeMemory(IntPtr memory);
        [DllImport("advapi32.dll")] private static extern uint LsaNtStatusToWinError(uint status);
        [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes { internal int Length; internal IntPtr Root, Name; internal uint Attributes; internal IntPtr Descriptor, Qos; }
        [StructLayout(LayoutKind.Sequential)] private struct LsaString { internal ushort Length, MaximumLength; internal IntPtr Buffer; }
        [StructLayout(LayoutKind.Sequential)] private struct QueryConfig { internal uint Type, Start, Error; internal IntPtr Binary, Group; internal uint Tag; internal IntPtr Dependencies, Account, Display; }
        [StructLayout(LayoutKind.Sequential)] private struct FailureActions { internal uint Reset; internal IntPtr Reboot, Command; internal uint Count; internal IntPtr Actions; }
        private static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        public static bool SameAccount(string actual, string expected)
        {
            if (actual != null && actual.StartsWith(@".\", StringComparison.Ordinal)) actual = Environment.MachineName + actual.Substring(1);
            return new NTAccount(actual).Translate(typeof(SecurityIdentifier)).Equals(new NTAccount(expected).Translate(typeof(SecurityIdentifier)));
        }
        public static byte[] OwnerDescriptor(string sid)
        {
            // Query config/status/dependents, start, stop, interrogate and READ_CONTROL only.
            // No change-config, write-DACL/owner or delete permission for the runtime owner.
            var owner = new SecurityIdentifier(sid);
            var security = new System.Security.AccessControl.RawSecurityDescriptor("O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x200BD;;;" + owner.Value + ")");
            byte[] descriptor = new byte[security.BinaryLength]; security.GetBinaryForm(descriptor, 0);
            return descriptor;
        }
        public static void RepairOwnedSecurity(string root, string account, string sid)
        {
            if (WindowsIdentity.GetCurrent().User.Value != sid || !new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
                throw new InvalidOperationException("Elevated enrolled owner required");
            if (!Validate(root, account)) throw new InvalidOperationException("Expected owned service is absent");
            using (var status = new System.ServiceProcess.ServiceController(Name))
                if (status.Status != System.ServiceProcess.ServiceControllerStatus.Stopped) throw new InvalidOperationException("Stop the owned service before security repair");
            byte[] descriptor = OwnerDescriptor(sid);
            IntPtr scm = OpenSCManager(null, null, 1), svc = IntPtr.Zero;
            if (scm == IntPtr.Zero) throw new Win32Exception();
            try { svc = OpenService(scm, Name, 0x40000); if (svc == IntPtr.Zero) throw new Win32Exception(); Check(SetServiceObjectSecurity(svc, 4, descriptor)); }
            finally { if (svc != IntPtr.Zero) CloseServiceHandle(svc); CloseServiceHandle(scm); }
        }
        public static string Binary(string root) { return "\"" + System.IO.Path.Combine(root, "RunnerHost.exe") + "\" --service"; }
        public static string Plan(string root, string account)
        {
            return "Name=" + Name + "; binary=" + Binary(root) + "; account=" + account + "; start=Manual; recovery=None; profile=owner; child=restricted-medium; production/enrollment=unchanged";
        }
        public static bool Validate(string root, string account)
        {
            IntPtr scm = OpenSCManager(null, null, 1);
            if (scm == IntPtr.Zero) throw new Win32Exception();
            IntPtr svc = IntPtr.Zero;
            try
            {
                svc = OpenService(scm, Name, 1);
                if (svc == IntPtr.Zero)
                {
                    if (Marshal.GetLastWin32Error() == 1060) return false;
                    throw new Win32Exception();
                }
                uint size; QueryServiceConfig(svc, IntPtr.Zero, 0, out size);
                IntPtr data = Marshal.AllocHGlobal((int)size);
                try
                {
                    Check(QueryServiceConfig(svc, data, size, out size));
                    var cfg = (QueryConfig)Marshal.PtrToStructure(data, typeof(QueryConfig));
                    if (cfg.Type != 0x10 || cfg.Start != 3 || cfg.Error != 1 ||
                        Marshal.PtrToStringUni(cfg.Binary) != Binary(root) ||
                        !SameAccount(Marshal.PtrToStringUni(cfg.Account), account) ||
                        !String.IsNullOrEmpty(Marshal.PtrToStringUni(cfg.Dependencies)))
                        throw new InvalidOperationException("Existing service path/account/start drift: no changes permitted");
                }
                finally { Marshal.FreeHGlobal(data); }
                QueryServiceConfig2(svc, 1, IntPtr.Zero, 0, out size);
                data = Marshal.AllocHGlobal((int)size);
                try
                {
                    Check(QueryServiceConfig2(svc, 1, data, size, out size));
                    if (Marshal.PtrToStringUni(Marshal.ReadIntPtr(data)) != Description) throw new InvalidOperationException("Service is not this owned package");
                }
                finally { Marshal.FreeHGlobal(data); }
                QueryServiceConfig2(svc, 2, IntPtr.Zero, 0, out size);
                data = Marshal.AllocHGlobal((int)size);
                try
                {
                    Check(QueryServiceConfig2(svc, 2, data, size, out size));
                    var failure = (FailureActions)Marshal.PtrToStructure(data, typeof(FailureActions));
                    if (failure.Count != 0 || !String.IsNullOrEmpty(Marshal.PtrToStringUni(failure.Command)) || !String.IsNullOrEmpty(Marshal.PtrToStringUni(failure.Reboot)))
                        throw new InvalidOperationException("Automatic service recovery is forbidden");
                }
                finally { Marshal.FreeHGlobal(data); }
                QueryServiceConfig2(svc, 8, IntPtr.Zero, 0, out size);
                data = Marshal.AllocHGlobal((int)size);
                try
                {
                    Check(QueryServiceConfig2(svc, 8, data, size, out size));
                    if (Marshal.ReadInt32(data) != 0) throw new InvalidOperationException("Automatic service triggers are forbidden");
                }
                finally { Marshal.FreeHGlobal(data); }
                return true;
            }
            finally { if (svc != IntPtr.Zero) CloseServiceHandle(svc); CloseServiceHandle(scm); }
        }
        public static void Create(string root, string account, string sid, IntPtr password)
        {
            if (new NTAccount(account).Translate(typeof(SecurityIdentifier)).Value != sid || WindowsIdentity.GetCurrent().User.Value != sid)
                throw new InvalidOperationException("The enrolled Windows owner must install");
            if (Validate(root, account)) throw new InvalidOperationException("Service already exists; credentials must not be replaced");
            byte[] descriptor = OwnerDescriptor(sid); // Validate before creating anything.
            IntPtr scm = OpenSCManager(null, null, 3);
            if (scm == IntPtr.Zero) throw new Win32Exception();
            IntPtr svc = IntPtr.Zero;
            try
            {
                svc = CreateService(scm, Name, "Squires Fixerrors Runner", 0xF01FF, 0x10, 3, 1, Binary(root), null, IntPtr.Zero, null, account, password);
                if (svc == IntPtr.Zero) throw new Win32Exception();
                IntPtr text = Marshal.StringToHGlobalUni(Description), pointer = Marshal.AllocHGlobal(IntPtr.Size);
                try { Marshal.WriteIntPtr(pointer, text); Check(ChangeServiceConfig2(svc, 1, pointer)); }
                finally { Marshal.FreeHGlobal(pointer); Marshal.FreeHGlobal(text); }
                var actions = new FailureActions();
                pointer = Marshal.AllocHGlobal(Marshal.SizeOf(actions));
                try { Marshal.StructureToPtr(actions, pointer, false); Check(ChangeServiceConfig2(svc, 2, pointer)); }
                finally { Marshal.FreeHGlobal(pointer); }
                Check(SetServiceObjectSecurity(svc, 4, descriptor));
            }
            finally { if (svc != IntPtr.Zero) CloseServiceHandle(svc); CloseServiceHandle(scm); }
            if (!Validate(root, account)) throw new InvalidOperationException("Installed service disappeared; owner reconciliation required");
        }
        private static byte[] SidBytes(string sid)
        {
            var value = new SecurityIdentifier(sid); byte[] bytes = new byte[value.BinaryLength]; value.GetBinaryForm(bytes, 0); return bytes;
        }
        public static bool HasServiceLogon(string sid)
        {
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf(typeof(ObjectAttributes)) };
            IntPtr policy; uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x800, out policy);
            if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
            try
            {
                IntPtr rights; uint count; status = LsaEnumerateAccountRights(policy, SidBytes(sid), out rights, out count);
                if (status == 0xC0000034) return false;
                if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
                try
                {
                    for (int i = 0; i < count; i++)
                    {
                        var right = (LsaString)Marshal.PtrToStructure(IntPtr.Add(rights, i * Marshal.SizeOf(typeof(LsaString))), typeof(LsaString));
                        if (Marshal.PtrToStringUni(right.Buffer, right.Length / 2) == "SeServiceLogonRight") return true;
                    }
                    return false;
                }
                finally { LsaFreeMemory(rights); }
            }
            finally { LsaClose(policy); }
        }
        public static void GrantServiceLogon(string sid)
        {
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf(typeof(ObjectAttributes)) };
            IntPtr policy; uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x810, out policy);
            if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
            IntPtr text = Marshal.StringToHGlobalUni("SeServiceLogonRight");
            try
            {
                var right = new LsaString { Buffer = text, Length = 38, MaximumLength = 40 };
                status = LsaAddAccountRights(policy, SidBytes(sid), new[] { right }, 1);
                if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status));
            }
            finally { Marshal.FreeHGlobal(text); LsaClose(policy); }
        }
    }
}
