using ElectronCgi.DotNet;

static void Main(string[] args)
{
    var connection = new ConnectionBuilder()
                        .WithLogging()
                        .Build();

    // expects a request named "greeting" with a string argument and returns a string
    connection.On("greeting", (string name) =>
    {
        return $"Hello {name}!";
    });

    // wait for incoming requests
    connection.Listen();
}