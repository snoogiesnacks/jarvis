"""Bounded Gen1 tracking probe. No camera, network, firmware or display APIs.

Uses Python's built-in ctypes against the installed Windows x64 SDK C ABI.
SDK headers and demo source reviewed: 2.4.1, October 23, 2026.
"""
import argparse
import ctypes as C
import json
import math
import os
from pathlib import Path
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--pid', type=lambda x: int(x, 0), required=True)
    parser.add_argument('--seconds', type=int, default=10, choices=range(1, 61))
    args = parser.parse_args()
    if os.name != 'nt' or C.sizeof(C.c_void_p) != 8:
        parser.error('Windows x64 Python required')
    root = args.sdk.resolve(strict=True) / 'x86_64'
    # Restrict dependency lookup to the explicit SDK directory and Windows defaults.
    directory = os.add_dll_directory(str(root))
    sdk = C.CDLL(str(root / 'glasses.dll'))
    def bind(name, result, *params):
        fn = getattr(sdk, name)
        fn.restype, fn.argtypes = result, list(params)
        return fn
    ptr = C.c_void_p
    version = bind('GetVersionString', C.c_char_p)
    valid = bind('xr_device_provider_is_product_id_valid', C.c_int, C.c_int)
    market = bind('xr_device_provider_get_market_name', C.c_int, C.c_int, C.c_char_p, C.POINTER(C.c_int))
    create = bind('xr_device_provider_create', ptr, C.c_int)
    kind = bind('xr_device_provider_get_device_type', C.c_int, ptr)
    initialize = bind('xr_device_provider_initialize', C.c_int, ptr, C.c_char_p, C.c_char_p)
    start = bind('xr_device_provider_start', C.c_int, ptr)
    stop = bind('xr_device_provider_stop', C.c_int, ptr)
    shutdown = bind('xr_device_provider_shutdown', C.c_int, ptr)
    destroy = bind('xr_device_provider_destroy', None, ptr)
    callback_type = C.CFUNCTYPE(None, C.POINTER(C.c_float), C.c_uint64)
    register = bind('xr_device_provider_register_imu_pose_callback', C.c_int, ptr, callback_type)
    open_imu = bind('xr_device_provider_open_imu', C.c_int, ptr, C.c_uint8, C.c_uint8)
    close_imu = bind('xr_device_provider_close_imu', C.c_int, ptr, C.c_uint8)
    bind('xr_device_provider_set_log_level', None, C.c_int)(0)
    if not valid(args.pid):
        raise RuntimeError('Unsupported product ID')
    name, length = C.create_string_buffer(128), C.c_int(128)
    if market(args.pid, name, C.byref(length)) != 0:
        raise RuntimeError('Market-name lookup failed')
    print(json.dumps({'sdk': version().decode(), 'model': name.value.decode(), 'pid': hex(args.pid)}), flush=True)
    handle = create(args.pid)
    if not handle:
        raise RuntimeError('Create failed: disconnected or device busy')
    initialized = started = opened = False
    lock = threading.Lock()
    state = {'samples': 0, 'invalid': 0, 'latest': None, 'last_host': None, 'max_gap_ms': 0}
    def receive(data, timestamp):
        if not data:
            return
        values = [float(data[i]) for i in range(7)]
        now = time.monotonic()
        with lock:
            if state['last_host'] is not None:
                state['max_gap_ms'] = max(state['max_gap_ms'], (now - state['last_host']) * 1000)
            state['last_host'] = now
            state['samples'] += 1
            norm = math.sqrt(sum(v*v for v in values[3:]))
            if not all(math.isfinite(v) for v in values) or not 0.9 <= norm <= 1.1:
                state['invalid'] += 1
            state['latest'] = {'device_timestamp': timestamp, 'roll_pitch_yaw_qw_qx_qy_qz': values}
    callback = callback_type(receive)  # Retain until provider threads have stopped.
    def check(label, code):
        if code != 0:
            raise RuntimeError(f'{label} failed: {code}')
    cleanup_errors = []
    try:
        if kind(handle) != 0:
            raise RuntimeError('Probe restricted to Gen1; refusing other device families')
        check('initialize', initialize(handle, None, None)); initialized = True
        check('start', start(handle)); started = True
        check('register', register(handle, callback))
        # Mode 1 = processed pose, frequency 0 = 60 Hz, from local SDK header.
        check('open_imu', open_imu(handle, 1, 0)); opened = True
        for _ in range(args.seconds):
            time.sleep(1)
            with lock:
                age = None if state['last_host'] is None else (time.monotonic() - state['last_host']) * 1000
                print(json.dumps({'samples': state['samples'], 'invalid': state['invalid'], 'age_ms': age, 'latest': state['latest']}), flush=True)
        with lock:
            passed = state['samples'] > 0 and state['invalid'] == 0 and age is not None and age < 500 and state['max_gap_ms'] < 500
            summary = {'result': 'PASS' if passed else 'FAIL', 'scope': 'finite normalized pose delivery only; axes and display behavior require human verification', 'max_gap_ms': state['max_gap_ms']}
    finally:
        # Follow demo lifecycle; never destroy a running callback owner first.
        for enabled, label, fn in [(opened, 'close_imu', lambda: close_imu(handle, 1)), (started, 'stop', lambda: stop(handle)), (initialized, 'shutdown', lambda: shutdown(handle))]:
            if enabled:
                code = fn()
                if code != 0:
                    cleanup_errors.append({'step': label, 'code': code})
        destroy(handle)
        directory.close()
    summary['cleanup_errors'] = cleanup_errors
    print(json.dumps(summary), flush=True)
    return 0 if passed and not cleanup_errors else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as error:
        print(json.dumps({'result': 'FAIL', 'error': str(error)}), flush=True)
        raise SystemExit(1)
