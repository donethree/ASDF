using System.Globalization;
using Orders.Domain;
using Orders.Export;
using Xunit;

namespace Orders.Tests;

public class OrderCsvExporterTests
{
    private static Order AnOrder(string customer = "Ana Diaz", decimal total = 12.5m) => new()
    {
        OrderId = "o-1", Date = new DateOnly(2026, 3, 1), CustomerName = customer, Total = total, StoreId = "s-1",
    };

    [Fact]
    public void An_empty_day_is_just_the_header() =>
        Assert.Equal("OrderId,Date,Customer,Total\r\n", OrderCsvExporter.ToCsv([]));

    [Fact]
    public void Quotes_a_name_with_a_comma() =>
        Assert.Contains("\"Diaz, Ana\"", OrderCsvExporter.ToCsv([AnOrder(customer: "Diaz, Ana")]));

    [Fact]
    public void Writes_totals_with_a_dot_whatever_the_server_culture()
    {
        CultureInfo.CurrentCulture = new CultureInfo("de-DE");
        Assert.Contains(",12.50\r\n", OrderCsvExporter.ToCsv([AnOrder()]));
    }
}
