namespace Orders.Storage;

public sealed class BlobUploader(HttpClient http)
{
    // Uploads a file to the shared exports container. Uploading the same path again replaces it.
    public async Task UploadAsync(string path, string content)
    {
        using var body = new StringContent(content);
        using var response = await http.PutAsync($"exports/{path}", body);
        response.EnsureSuccessStatusCode();
    }
}
