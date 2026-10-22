using System.Text;
using Microsoft.AspNetCore.Mvc;
using Orders.Domain;
using Orders.Export;

namespace Orders.Api;

[ApiController]
[Route("api/export")]
public sealed class ExportController(IOrderRepository orders) : ControllerBase
{
    // Lets a store manager download one day's orders as CSV.
    [HttpGet("{day}")]
    public IActionResult Download(DateOnly day)
    {
        var csv = OrderCsvExporter.ToCsv(orders.PlacedOn(day));
        return File(Encoding.UTF8.GetBytes(csv), "text/csv", $"orders-{day:yyyy-MM-dd}.csv");
    }
}
