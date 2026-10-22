using Orders.Domain;
using Orders.Export;
using Orders.Storage;

namespace Orders.Jobs;

// Runs at 01:00 UTC. Writes yesterday's orders to orders/<yyyy-MM-dd>.csv in the shared exports
// container, where other teams pick it up.
public sealed class NightlyExportJob(IOrderRepository orders, BlobUploader uploader)
{
    public async Task RunAsync(DateOnly today)
    {
        var day = today.AddDays(-1);
        var csv = OrderCsvExporter.ToCsv(orders.PlacedOn(day));
        await uploader.UploadAsync($"orders/{day:yyyy-MM-dd}.csv", csv);
    }
}
