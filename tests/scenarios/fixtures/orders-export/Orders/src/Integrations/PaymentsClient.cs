using Orders.Common.Resilience;

namespace Orders.Integrations;

public sealed class PaymentsClient(HttpClient http)
{
    public Task CaptureAsync(string orderId) =>
        Retry.WithBackoffAsync(async () =>
        {
            using var response = await http.PostAsync($"payments/{orderId}/capture", content: null);
            response.EnsureSuccessStatusCode();
        });
}
