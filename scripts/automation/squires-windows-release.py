"""Installed beside the trusted bridge. Keep every fap descendant in one Windows job."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import sys


class BasicLimits(ctypes.Structure):
    _fields_ = [
        ('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
        ('flags', wintypes.DWORD), ('min_working_set', ctypes.c_size_t),
        ('max_working_set', ctypes.c_size_t), ('active_processes', wintypes.DWORD),
        ('affinity', ctypes.c_size_t), ('priority_class', wintypes.DWORD),
        ('scheduling_class', wintypes.DWORD),
    ]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        'read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes',
    )]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ('basic', BasicLimits), ('io', IoCounters),
        ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
        ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t),
    ]


def contain_process_tree():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise OSError('release job unavailable')
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not \
            kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        kernel.CloseHandle(job)
        raise OSError('release process containment unavailable')
    # Retain the non-inheritable handle until process exit. Closing it earlier
    # would terminate this process and its children.
    return job


def main():
    if sys.platform != 'win32' or sys.argv[1:] not in ([], ['repair'], ['batch']):
        return 2
    try:
        job = contain_process_tree()
    except OSError:
        print('{"status":"blocked","reason":"process_containment_unavailable"}', flush=True)
        return 2
    if not job:
        return 2
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if sys.argv[1:] in (['repair'], ['batch']):
        import squires_repair
        return squires_repair.batch_main() if sys.argv[1:] == ['batch'] else squires_repair.main()
    import squires_release
    return squires_release.main()


if __name__ == '__main__':
    sys.exit(main())
