/** Encode values as data, never as PowerShell source (including smart quotes). */
export function psString(value: string): string {
	return `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, "utf8").toString("base64")}')))`;
}

/** Keep successful fields, but never present a failed collection as a healthy empty result. */
export function diagnosticCommand(command: string): string {
	return `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$Error.Clear()
$diagnosticOutput = (& {
${command}
} | Out-String)
$diagnosticFailures = @($Error | Select-Object -First 8 | ForEach-Object {
  [ordered]@{ source = [string]$_.InvocationInfo.MyCommand; message = [string]$_.Exception.Message }
})
try {
  $diagnosticResult = ConvertFrom-Json -InputObject $diagnosticOutput -AsHashtable -ErrorAction Stop
  if ($diagnosticFailures.Count -gt 0 -and $diagnosticResult -is [System.Collections.IDictionary]) {
    $diagnosticResult['collectionErrors'] = $diagnosticFailures
    $diagnosticResult['degraded'] = $true
  }
  ConvertTo-Json -InputObject $diagnosticResult -Depth 20 -Compress
} catch {
  ConvertTo-Json @{ error = '采集输出无法解析'; collectionErrors = $diagnosticFailures } -Depth 4 -Compress
}
`;
}

export function collectionNotice(result: { degraded?: unknown }): string {
	return result?.degraded ? "部分采集失败，空值/空清单不代表正常或没有设备；请结合返回的错误字段判断。" : "";
}

/** PDH handles legacy and v2 counters without requiring Perflib registry tables. */
export const COUNTER_HELPERS = String.raw`
function Get-LocalizedCounterPath([string]$object, [string]$counter) {
  if (-not ('CstPilot.CounterPath' -as [type])) {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CstPilot {
  public static class CounterPath {
    [StructLayout(LayoutKind.Sequential)]
    private struct Info {
      public uint Length, Type, Version, Status;
      public int Scale, DefaultScale;
      public UIntPtr UserData, QueryUserData;
      public IntPtr FullPath;
    }
    [DllImport("pdh.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    private static extern uint PdhOpenQueryW(string source, UIntPtr data, out IntPtr query);
    [DllImport("pdh.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    private static extern uint PdhAddEnglishCounterW(IntPtr query, string path, UIntPtr data, out IntPtr counter);
    [DllImport("pdh.dll", ExactSpelling=true)]
    private static extern uint PdhGetCounterInfoW(IntPtr counter, [MarshalAs(UnmanagedType.Bool)] bool explain, ref uint size, IntPtr info);
    [DllImport("pdh.dll", ExactSpelling=true)]
    private static extern uint PdhCloseQuery(IntPtr query);
    private static void Check(uint status) {
      if (status != 0) throw new InvalidOperationException("PDH error 0x" + status.ToString("X8"));
    }
    public static string Localize(string path) {
      IntPtr query;
      Check(PdhOpenQueryW(null, UIntPtr.Zero, out query));
      try {
        IntPtr counter;
        Check(PdhAddEnglishCounterW(query, path, UIntPtr.Zero, out counter));
        uint size = 0;
        uint status = PdhGetCounterInfoW(counter, false, ref size, IntPtr.Zero);
        if (status != 0x800007D2) Check(status);
        if (size == 0 || size > 1048576) throw new InvalidOperationException("Invalid PDH info size");
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try {
          Check(PdhGetCounterInfoW(counter, false, ref size, buffer));
          string result = Marshal.PtrToStringUni(Marshal.PtrToStructure<Info>(buffer).FullPath);
          if (String.IsNullOrEmpty(result)) throw new InvalidOperationException("Empty PDH counter path");
          return result;
        } finally { Marshal.FreeHGlobal(buffer); }
      } finally { PdhCloseQuery(query); }
    }
  }
}
'@
  }
  return [CstPilot.CounterPath]::Localize(('\' + $object + '(*)\' + $counter))
}
function Get-DiagnosticCounter([string]$object, [string[]]$counter) {
  $paths = @($counter | ForEach-Object { Get-LocalizedCounterPath $object $_ })
  Get-Counter -Counter $paths -ErrorAction Stop
}
`;
