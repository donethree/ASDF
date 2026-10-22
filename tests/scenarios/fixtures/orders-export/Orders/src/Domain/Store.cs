namespace Orders.Domain;

public sealed record Store(string StoreId, string Name, string DefaultCurrency);

public interface IStoreDirectory
{
    Store Get(string storeId);
}
