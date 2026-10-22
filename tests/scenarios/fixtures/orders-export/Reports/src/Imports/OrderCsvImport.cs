using System.Globalization;
using Reports.Sales;

namespace Reports.Imports;

// Imports the Orders service's nightly file, orders/<yyyy-MM-dd>.csv, into the sales table.
public sealed class OrderCsvImport(ISalesTable sales)
{
    private const string ExpectedHeader = "OrderId,Date,Customer,Total";

    public void Import(TextReader csv)
    {
        var header = csv.ReadLine();
        if (header != ExpectedHeader)
            throw new InvalidDataException($"orders file: unexpected header '{header}'");

        while (csv.ReadLine() is { } line)
        {
            var fields = CsvLine.Split(line);
            sales.Add(fields[0], DateOnly.Parse(fields[1], CultureInfo.InvariantCulture), fields[2],
                decimal.Parse(fields[3], CultureInfo.InvariantCulture));
        }
    }
}
