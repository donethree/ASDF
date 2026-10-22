namespace Orders.Common;

public static class CsvEscaping
{
    // Quotes a field that holds a comma, a quote or a line break, doubling any quotes (RFC 4180).
    public static string Escape(string field)
    {
        if (field.IndexOfAny([',', '"', '\n', '\r']) < 0) return field;
        return "\"" + field.Replace("\"", "\"\"") + "\"";
    }
}
