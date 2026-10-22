namespace Reports.Imports;

public interface IExportsContainer
{
    TextReader Open(string path);
}

// Runs at 03:00 UTC, after the other services' nightly exports.
public sealed class ImportScheduler(IExportsContainer exports, OrderCsvImport orders)
{
    public void RunNightly(DateOnly today)
    {
        var day = today.AddDays(-1);
        using var file = exports.Open($"orders/{day:yyyy-MM-dd}.csv");
        orders.Import(file);
    }
}
