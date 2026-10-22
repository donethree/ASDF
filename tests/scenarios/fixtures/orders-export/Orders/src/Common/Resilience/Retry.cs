namespace Orders.Common.Resilience;

public static class Retry
{
    // Runs the action, retrying transient failures (timeouts and HTTP 5xx) with exponential backoff.
    // Any other exception is thrown at once.
    public static async Task WithBackoffAsync(Func<Task> action, int attempts = 3, TimeSpan? firstDelay = null)
    {
        var delay = firstDelay ?? TimeSpan.FromSeconds(2);
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await action();
                return;
            }
            catch (Exception e) when (attempt < attempts && IsTransient(e))
            {
                await Task.Delay(delay);
                delay *= 2;
            }
        }
    }

    public static bool IsTransient(Exception e) =>
        e is TimeoutException || e is TaskCanceledException ||
        (e is HttpRequestException http && (int?)http.StatusCode >= 500);
}
