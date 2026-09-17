using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Only the already identity-verified synthetic fixture may call this helper.
// It recovers the earlier hidden-window harness defect, not arbitrary desktop apps.
public static class SyntheticWindowClose {
    public sealed class Window {
        public long Handle;
        public uint ProcessId;
        public uint ThreadId;
        public long Owner;
        public bool Visible;
        public string ClassName;
    }
    public sealed class Result {
        public string Status = "refused";
        public Window[] Windows;
        public Window Target;
        public bool Posted;
        public int NativeError;
    }
    delegate bool EnumCallback(IntPtr handle, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern int GetClassName(IntPtr handle, StringBuilder name, int count);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr handle, uint command);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll", EntryPoint = "PostMessageW", SetLastError = true)] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

    static Window Read(IntPtr handle) {
        uint pid;
        uint thread = GetWindowThreadProcessId(handle, out pid);
        var name = new StringBuilder(512);
        if (thread == 0 || GetClassName(handle, name, name.Capacity) == 0) return null;
        return new Window { Handle = handle.ToInt64(), ProcessId = pid, ThreadId = thread,
            Owner = GetWindow(handle, 4).ToInt64(), Visible = IsWindowVisible(handle), ClassName = name.ToString() };
    }
    public static Window[] Enumerate(uint processId) {
        var windows = new List<Window>();
        bool incomplete = false;
        EnumCallback callback = delegate(IntPtr handle, IntPtr state) {
            uint pid;
            if (GetWindowThreadProcessId(handle, out pid) != 0 && pid == processId) {
                var window = Read(handle);
                if (window == null || window.ProcessId != processId) incomplete = true;
                else windows.Add(window);
            }
            return true;
        };
        if (!EnumWindows(callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        GC.KeepAlive(callback);
        if (incomplete) throw new InvalidOperationException("Synthetic window inventory changed.");
        return windows.ToArray();
    }
    // Pure selection policy: one hidden, unowned Windows Forms frame. Only known
    // framework support windows may coexist; another frame or unknown class refuses.
    public static Window Select(uint processId, Window[] windows) {
        if (processId == 0 || windows == null) return null;
        Window target = null;
        foreach (var window in windows) {
            if (window == null) return null;
            if (window.ProcessId != processId) continue;
            if (window.Handle == 0 || window.Handle == 0xffff || window.ThreadId == 0 || window.ClassName == null) return null;
            if (window.ClassName.StartsWith("WindowsForms10.Window.", StringComparison.Ordinal)) {
                if (target != null || window.Visible || window.Owner != 0) return null;
                target = window;
            } else if (window.Visible || !(window.ClassName.StartsWith(".NET-BroadcastEventWindow.", StringComparison.Ordinal)
                || window.ClassName == "GDI+ Hook Window Class" || window.ClassName == "IME")) return null;
        }
        return target;
    }
    public static bool Same(Window first, Window second) {
        return first != null && second != null && first.Handle == second.Handle
            && first.ProcessId == second.ProcessId && first.ThreadId == second.ThreadId
            && first.Owner == second.Owner && first.Visible == second.Visible && first.ClassName == second.ClassName;
    }
    public static Result Request(Process verifiedProcess) {
        var result = new Result();
        // Caller retains the process handle after exact path/hash/session/creation checks.
        if (verifiedProcess.HasExited) return result;
        uint pid = checked((uint)verifiedProcess.Id);
        result.Windows = Enumerate(pid);
        result.Target = Select(pid, result.Windows);
        if (result.Target == null) return result;
        var fresh = Select(pid, Enumerate(pid));
        if (verifiedProcess.HasExited || !Same(result.Target, fresh)
            || !Same(fresh, Read(new IntPtr(fresh.Handle)))) return result;
        // Queue only WM_CLOSE to this exact HWND. Never broadcast, force exit, or
        // infer termination from posting success; the caller performs a bounded wait.
        result.Posted = PostMessage(new IntPtr(fresh.Handle), 0x0010, IntPtr.Zero, IntPtr.Zero);
        result.NativeError = result.Posted ? 0 : Marshal.GetLastWin32Error();
        result.Status = result.Posted ? "close-posted" : "refused";
        return result;
    }
}
