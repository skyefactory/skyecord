using ElectronCgi.DotNet;

var connection = new ConnectionBuilder().WithLogging().Build();

// Register a handler that Node.js can invoke
connection.On<string, string>("greet", name => {
    // You can execute any code from your .NET NuGet packages here
    return $"Hello {name} from .NET!";
});