// Database handles are always MSIDBOPEN_READONLY. No installer session is opened.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public sealed class ReadOnlyMsi : IDisposable
{
    private uint database;
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiOpenDatabaseW(string path, IntPtr mode, out uint handle);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiDatabaseOpenViewW(uint db, string sql, out uint view);
    [DllImport("msi.dll")] private static extern uint MsiViewExecute(uint view, uint record);
    [DllImport("msi.dll")] private static extern uint MsiViewFetch(uint view, out uint record);
    [DllImport("msi.dll")] private static extern uint MsiRecordGetFieldCount(uint record);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiRecordGetStringW(uint record, uint field, StringBuilder value, ref uint length);
    [DllImport("msi.dll")] private static extern uint MsiRecordReadStream(uint record, uint field, byte[] buffer, ref uint length);
    [DllImport("msi.dll")] private static extern uint MsiCloseHandle(uint handle);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiGetSummaryInformationW(uint db, string path, uint updateCount, out uint summary);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiSummaryInfoGetPropertyW(uint summary, uint property, out uint type, out int number, IntPtr time, StringBuilder value, ref uint length);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiGetProductInfoExW(string product, string sid, uint context, string property, StringBuilder value, ref uint length);
    [DllImport("msi.dll", CharSet = CharSet.Unicode)] private static extern uint MsiEnumRelatedProductsW(string upgradeCode, uint reserved, uint index, StringBuilder productCode);

    private static void Check(uint result) { if (result != 0) throw new Win32Exception((int)result); }
    public ReadOnlyMsi(string path) { Check(MsiOpenDatabaseW(path, IntPtr.Zero, out database)); }
    public void Dispose() { if (database != 0) { MsiCloseHandle(database); database = 0; } }
    public string[][] Query(string sql)
    {
        uint view; Check(MsiDatabaseOpenViewW(database, sql, out view));
        try {
            Check(MsiViewExecute(view, 0));
            var rows = new List<string[]>(); uint record; uint result;
            while ((result = MsiViewFetch(view, out record)) == 0) {
                try {
                    var row = new string[MsiRecordGetFieldCount(record)];
                    for (uint field = 1; field <= row.Length; field++) {
                        uint size = 32768; var value = new StringBuilder((int)size);
                        Check(MsiRecordGetStringW(record, field, value, ref size)); row[field - 1] = value.ToString();
                    }
                    rows.Add(row);
                    if (rows.Count > 10000) throw new InvalidDataException("MSI table exceeds inspection limit.");
                } finally { MsiCloseHandle(record); }
            }
            if (result != 259) Check(result);
            return rows.ToArray();
        } finally { MsiCloseHandle(view); }
    }
    public string Summary(uint property)
    {
        uint summary; Check(MsiGetSummaryInformationW(database, null, 0, out summary));
        try {
            uint type, size = 32768; int number; var text = new StringBuilder((int)size);
            Check(MsiSummaryInfoGetPropertyW(summary, property, out type, out number, IntPtr.Zero, text, ref size));
            return type == 2 || type == 3 ? number.ToString(System.Globalization.CultureInfo.InvariantCulture) : text.ToString();
        } finally { MsiCloseHandle(summary); }
    }
    public void CopyStream(string stream, string destination)
    {
        uint view; Check(MsiDatabaseOpenViewW(database, "SELECT `Data` FROM `_Streams` WHERE `Name` = '" + stream.Replace("'", "''") + "'", out view));
        try {
            Check(MsiViewExecute(view, 0)); uint record; Check(MsiViewFetch(view, out record));
            try {
                using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    byte[] buffer = new byte[65536]; long total = 0;
                    while (true) {
                        uint size = (uint)buffer.Length; Check(MsiRecordReadStream(record, 1, buffer, ref size));
                        if (size == 0) break;
                        total += size; if (total > 536870912) throw new InvalidDataException("Cabinet exceeds inspection limit.");
                        output.Write(buffer, 0, (int)size);
                    }
                }
            } finally { MsiCloseHandle(record); }
        } finally { MsiCloseHandle(view); }
    }
    public static string ProductInfo(string product, uint context, string property)
    {
        uint size = 32768; var value = new StringBuilder((int)size);
        Check(MsiGetProductInfoExW(product, null, context, property, value, ref size));
        return value.ToString();
    }
    public static string[] RelatedProducts(string upgradeCode)
    {
        var products = new List<string>();
        for (uint index = 0; index < 10000; index++) {
            var product = new StringBuilder(39);
            uint result = MsiEnumRelatedProductsW(upgradeCode, 0, index, product);
            if (result == 259) return products.ToArray();
            Check(result); products.Add(product.ToString());
        }
        throw new InvalidDataException("Related product limit exceeded.");
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct CabinetFile {
        public IntPtr Name; public uint Size; public uint Error;
        public ushort Date; public ushort Time; public ushort Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Target;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct ExtractedFile {
        public IntPtr Target; public IntPtr Source; public uint Error; public uint Flags;
    }
    private delegate uint CabinetCallback(IntPtr context, uint notification, IntPtr p1, IntPtr p2);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupIterateCabinetW(string cabinet, uint reserved, CabinetCallback callback, IntPtr context);

    // Never use an archive member as a destination path. Extract exactly the known
    // MSI File keys to numbered files inside a newly owned scratch directory.
    public static string[] ExtractCabinet(string cabinet, string[] keys, string outputDirectory)
    {
        var paths = new string[keys.Length]; var seen = new HashSet<string>(StringComparer.Ordinal);
        string failure = null; long total = 0;
        CabinetCallback callback = (context, notification, p1, p2) => {
            try {
                if (notification == 0x11) {
                    var entry = Marshal.PtrToStructure<CabinetFile>(p1);
                    string name = Marshal.PtrToStringUni(entry.Name);
                    int index = Array.IndexOf(keys, name);
                    if (index < 0 || !seen.Add(name)) { failure = "Unexpected or duplicate cabinet member."; return 0; }
                    total += entry.Size;
                    if (total > 536870912) { failure = "Expanded media exceeds inspection limit."; return 0; }
                    string target = Path.Combine(outputDirectory, "payload-" + index + ".bin");
                    if (target.Length >= 260 || File.Exists(target)) { failure = "Unsafe extraction target."; return 0; }
                    entry.Target = target; Marshal.StructureToPtr(entry, p1, false); paths[index] = target;
                    return 1;
                }
                if (notification == 0x12) { failure = "Spanning cabinets are unsupported."; return 13; }
                if (notification == 0x13) return Marshal.PtrToStructure<ExtractedFile>(p1).Error;
                return 0;
            } catch { failure = "Cabinet inspection failed."; return 13; }
        };
        bool success = SetupIterateCabinetW(cabinet, 0, callback, IntPtr.Zero);
        GC.KeepAlive(callback);
        if (!success || failure != null || seen.Count != keys.Length) throw new InvalidDataException(failure ?? "Incomplete cabinet.");
        return paths;
    }
}
