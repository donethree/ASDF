namespace Reports.Sales;

public interface ISalesTable
{
    void Add(string orderId, DateOnly date, string customer, decimal total);
}
