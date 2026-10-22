using System.Collections.Concurrent;
using Orders.Domain;

namespace Orders.Stores;

// Store details change rarely, so they're cached for the life of the process.
public sealed class CachedStoreDirectory(IStoreSource source) : IStoreDirectory
{
    private readonly ConcurrentDictionary<string, Store> cache = new();

    public Store Get(string storeId) => cache.GetOrAdd(storeId, source.Load);
}

public interface IStoreSource
{
    Store Load(string storeId);
}
