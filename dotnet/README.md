# Inhumate RTI .NET Client

This is the C#/.NET client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/suite/).

See the Inhumate Suite [documentation](https://docs.inhumatesystems.com/) for more in-depth topics and an overview of the software suite.

Note: If you're planning on integrating the Unity game engine with the RTI, there's [a package](https://docs.inhumatesystems.com/integrations/unity/) specifically for that.

## Installing

### Using the dotnet CLI

```
dotnet add package Inhumate.RTI
```

### Using Visual Studio

1. Select *Project* > *Manage NuGet Packages* in the main menu.
2. In the *NuGet Package Manager* page, choose *nuget.org* as the *Package source*.
3. From the *Browse tab*, search for *Inhumate.RTI*, select *Inhumate.RTI* in the list, and then select *Install*.

## Quick Start

```c#
using Inhumate.RTI;

var rti = new RTIClient { Application = "C# RTI App" };
rti.WaitUntilConnected();

var done = false;
rti.Subscribe("hello", (string channel, object message) => {
    Console.WriteLine($"Received: {message}");
    done = true;
});
rti.Publish("hello", "Hello World!");
while (!done) Thread.Sleep(10);
```

## Building and running tests

Clone the project from [GitHub](https://github.com/inhumatesystems/rti-client), and in the *dotnet* folder:

```sh
dotnet restore
dotnet build
dotnet test
```

## Feedback & Contributing

Feedback and contributions of any kind are welcome.

- Please file bug reports and/or feature requests as [GitHub issues](https://github.com/inhumatesystems/rti-client/issues)
- Suggest code changes by creating a [pull request](https://github.com/inhumatesystems/rti-client/pulls)
- For any other questions, comments or inquiries, [get in touch](https://inhumatesystems.com/#contact)
