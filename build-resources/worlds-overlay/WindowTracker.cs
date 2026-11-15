using System;
using System.Runtime.InteropServices;
using System.Threading;
// Only observes the Minecraft PID supplied by Battly. No input hooks or injection.
public class WindowTracker {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor,Work; public uint Flags; }
  delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor,ref MONITORINFO info);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  // Monitor-sized windows are not necessarily exclusive fullscreen. Windows'
  // notification state identifies known exclusive Direct3D presentation; an
  // unavailable query remains conservative for older Windows installations.
  static bool BlocksOverlay(bool fullscreen) {
    if (!fullscreen) return false;
    int state;
    try { return SHQueryUserNotificationState(out state) != 0 || state == 3; }
    catch (EntryPointNotFoundException) { return true; }
  }
  public static void Main(string[] args) {
    int pid, owner;
    long overlay;
    if(args.Length!=3 || !int.TryParse(args[0],out pid) || !long.TryParse(args[1],out overlay) || !int.TryParse(args[2],out owner)) return;
    try { if(!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); }
    while(true) {
      try { using(var parent=System.Diagnostics.Process.GetProcessById(owner)) using(var game=System.Diagnostics.Process.GetProcessById(pid)) { if(parent.HasExited || game.HasExited) return; } } catch { return; }
      IntPtr selected=IntPtr.Zero;
      EnumWindows((hwnd,data)=>{uint candidate;GetWindowThreadProcessId(hwnd,out candidate);RECT r;
        if(candidate==pid && IsWindowVisible(hwnd) && !IsIconic(hwnd) && GetWindowRect(hwnd,out r) && r.Right-r.Left>=320 && r.Bottom-r.Top>=200) {selected=hwnd;return false;}return true;
      },IntPtr.Zero);
      RECT rect;
      bool visible=selected!=IntPtr.Zero && GetWindowRect(selected,out rect);
      if (visible) {
        GetClientRect(selected,out rect);
        POINT origin=new POINT();ClientToScreen(selected,ref origin);
        MONITORINFO monitor=new MONITORINFO();monitor.Size=Marshal.SizeOf(typeof(MONITORINFO));
        bool fullscreen=GetMonitorInfo(MonitorFromWindow(selected,2),ref monitor)
          && origin.X<=monitor.Monitor.Left && origin.Y<=monitor.Monitor.Top
          && origin.X+rect.Right-rect.Left>=monitor.Monitor.Right
          && origin.Y+rect.Bottom-rect.Top>=monitor.Monitor.Bottom;
        IntPtr active=GetForegroundWindow();
        uint activePid; GetWindowThreadProcessId(active,out activePid);
        Console.WriteLine("{\"visible\":"+((activePid==pid || active.ToInt64()==overlay)?"true":"false")+",\"fullscreen\":"+(fullscreen?"true":"false")+",\"exclusiveFullscreen\":"+(BlocksOverlay(fullscreen)?"true":"false")+",\"x\":"+origin.X+",\"y\":"+origin.Y+",\"width\":"+(rect.Right-rect.Left)+",\"height\":"+(rect.Bottom-rect.Top)+"}");
      } else Console.WriteLine("{\"visible\":false}");
      Thread.Sleep(250);
    }
  }
}
