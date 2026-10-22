namespace Orders.Domain;

public sealed record Order
{
    public required string OrderId { get; init; }
    public required DateOnly Date { get; init; }
    public required string CustomerName { get; init; }
    public required decimal Total { get; init; }
    public required string StoreId { get; init; }

    // ISO 4217 code, such as "EUR". Null on orders placed before stores could sell in more
    // than one currency: those orders are in their store's DefaultCurrency.
    public string? Currency { get; init; }
}
