namespace Orders.Domain;

public interface IOrderRepository
{
    IReadOnlyList<Order> PlacedOn(DateOnly day);
    IReadOnlyList<Order> ForCustomer(string customerName);
}
