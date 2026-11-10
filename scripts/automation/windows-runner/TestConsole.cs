using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// Disposable fixture launcher only; never included in the installed package.
public static class SquiresRunnerTestConsole
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo si, out ProcessInfo pi);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")] private static extern bool FreeConsole();
    private delegate bool Handler(uint signal);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GenerateConsoleCtrlEvent(uint signal, uint group);
    public static int Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "break") return 2;
        FreeConsole();
        if (!AttachConsole(UInt32.Parse(args[1]))) return 3;
        Handler ignore = signal => true;
        if (!SetConsoleCtrlHandler(ignore, true) || !GenerateConsoleCtrlEvent(1, 0)) return 4;
        System.Threading.Thread.Sleep(1000);
        GC.KeepAlive(ignore);
        FreeConsole();
        return 0;
    }
    public static int Start(string exe)
    {
        var si = new StartupInfo { Size = (uint)Marshal.SizeOf(typeof(StartupInfo)) };
        ProcessInfo pi;
        if (!CreateProcess(exe, new StringBuilder("\"" + exe + "\" --console review"), IntPtr.Zero, IntPtr.Zero, false, 0x10, IntPtr.Zero, System.IO.Path.GetDirectoryName(exe), ref si, out pi))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(pi.Thread); CloseHandle(pi.Process);
        return (int)pi.Pid;
    }
}
