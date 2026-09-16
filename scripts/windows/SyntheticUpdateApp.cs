// Disposable MSI acceptance fixture. No Prompt Vault configuration or data API.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;

static class SyntheticUpdateApp {
    const string Identifier = "com.nobodyworld.promptvault.updateacceptance";
    static IntPtr database;
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)] static extern int sqlite3_open16(string path, out IntPtr db);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_exec(IntPtr db, byte[] sql, Callback callback, IntPtr state, out IntPtr error);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)] static extern void sqlite3_free(IntPtr value);
    delegate int Callback(IntPtr state, int columns, IntPtr values, IntPtr names);
    static string Query(string sql) {
        var result = new StringBuilder();
        Callback callback = delegate(IntPtr state, int count, IntPtr values, IntPtr names) {
            for (int i = 0; i < count; i++) result.Append(Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(values, i * IntPtr.Size))).Append('|');
            result.Append('\n'); return 0;
        };
        IntPtr error;
        int code = sqlite3_exec(database, Encoding.UTF8.GetBytes(sql + "\0"), callback, IntPtr.Zero, out error);
        if (error != IntPtr.Zero) sqlite3_free(error);
        GC.KeepAlive(callback);
        if (code != 0) throw new InvalidOperationException("Synthetic SQLite operation failed: " + code);
        return result.ToString();
    }
    static string Logical() {
        return Query("SELECT id,body FROM records ORDER BY id; SELECT id,record_id,body FROM versions ORDER BY id; SELECT name,value FROM settings ORDER BY name;");
    }
    [STAThread] static int Main(string[] args) {
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) return 77;
        if (args.Length != 1 || (args[0] != "--run" && args[0] != "--seed" && args[0] != "--refuse-close" && args[0] != "--restart-failure" && args[0] != "--self-test")) return 64;
        if (args[0] == "--restart-failure") return 42;
        bool selfTest = args[0] == "--self-test";
        bool seed = args[0] == "--seed" || selfTest;
        string root = selfTest ? Path.Combine(Path.GetTempPath(), "prompt-vault-update-acceptance-selftest-" + Guid.NewGuid().ToString("N")) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Identifier);
        if (Directory.Exists(root) && (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return 65;
        if (!seed && !File.Exists(Path.Combine(root, "acceptance.db"))) return 66;
        Directory.CreateDirectory(root);
        foreach (string file in Directory.GetFiles(root)) if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) return 65;
        if (sqlite3_open16(Path.Combine(root, "acceptance.db"), out database) != 0) return 70;
        try {
            Query("PRAGMA journal_mode=WAL;");
            if (seed) {
                Query("CREATE TABLE records(id INTEGER PRIMARY KEY,body TEXT); CREATE TABLE versions(id INTEGER PRIMARY KEY,record_id INTEGER,body TEXT); CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT); INSERT INTO records VALUES(1,'synthetic fixture only'); INSERT INTO versions VALUES(1,1,'synthetic revision one'),(2,1,'synthetic revision two'); INSERT INTO settings VALUES('theme','acceptance');");
                // Supported synthetic backup and restore: SQLite snapshot, restore
                // into a separate disposable database, then logical comparison.
                string original = Logical();
                Query("VACUUM INTO '" + Path.Combine(root, "backup.db").Replace("'", "''") + "';");
                File.Copy(Path.Combine(root, "backup.db"), Path.Combine(root, "restore-check.db"), false);
                IntPtr active = database;
                if (sqlite3_open16(Path.Combine(root, "restore-check.db"), out database) != 0) return 71;
                bool equal = original == Logical(); sqlite3_close(database); database = active;
                if (!equal) return 72;
                File.WriteAllText(Path.Combine(root, "logical-expected.txt"), original);
            }
            if (Logical() != File.ReadAllText(Path.Combine(root, "logical-expected.txt"))) return 73;
            if (selfTest) return 0;
            var form = new Form { Text = "Prompt Vault Update Acceptance", Width = 430, Height = 180 };
            form.Controls.Add(new Label { Text = "Disposable synthetic MSI fixture\nRecords, versions, settings and backup verified.", Dock = DockStyle.Fill });
            bool refusing = args[0] == "--refuse-close";
            form.FormClosing += delegate(object sender, FormClosingEventArgs e) { if (refusing) e.Cancel = true; };
            // Timeout fixture refuses WM_CLOSE for 15 seconds, then allows a
            // later explicit graceful close. It never requires forced killing.
            var timer = new Timer { Interval = 15000 };
            timer.Tick += delegate { refusing = false; timer.Stop(); };
            if (refusing) timer.Start();
            form.Shown += delegate { File.WriteAllText(Path.Combine(root, "logical-observed.txt"), Logical()); };
            Application.Run(form); timer.Dispose();
            return 0;
        } finally {
            sqlite3_close(database);
            if (selfTest) {
                // Only this newly created, fixed-prefix temp fixture is eligible.
                // Unknown files or links stop cleanup and preserve evidence.
                string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (!Path.GetFullPath(root).StartsWith(temp, StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(root).StartsWith("prompt-vault-update-acceptance-selftest-", StringComparison.Ordinal) || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0 || Directory.GetDirectories(root).Length != 0) throw new InvalidOperationException("Self-test cleanup boundary failed");
                foreach (string file in Directory.GetFiles(root)) {
                    string name = Path.GetFileName(file);
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || (name != "acceptance.db" && name != "acceptance.db-wal" && name != "acceptance.db-shm" && name != "backup.db" && name != "restore-check.db" && name != "restore-check.db-wal" && name != "restore-check.db-shm" && name != "logical-expected.txt")) throw new InvalidOperationException("Unknown self-test file retained");
                }
                foreach (string file in Directory.GetFiles(root)) File.Delete(file);
                Directory.Delete(root, false);
            }
        }
    }
}
