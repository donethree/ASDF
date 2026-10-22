using System.Globalization;
using System.Text;
using Orders.Common;
using Orders.Domain;

namespace Orders.Export;

public static class OrderCsvExporter
{
    public const string Header = "OrderId,Date,Customer,Total";

    public static string ToCsv(IEnumerable<Order> orders)
    {
        var csv = new StringBuilder();
        csv.Append(Header).Append("\r\n");
        foreach (var order in orders)
        {
            csv.Append(CsvEscaping.Escape(order.OrderId)).Append(',')
               .Append(order.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append(',')
               .Append(CsvEscaping.Escape(order.CustomerName)).Append(',')
               // Invariant culture: servers set to de-DE wrote "12,50", which split the column in two.
               .Append(order.Total.ToString("0.00", CultureInfo.InvariantCulture))
               .Append("\r\n");
        }
        return csv.ToString();
    }
}
