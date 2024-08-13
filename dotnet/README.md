# Inhumate RTI .NET Client

This is the C#/.NET client for the Inhumate RTI
(RunTime Infrastructure), part of the [Inhumate Suite](https://inhumatesystems.com/products/sboss/)
for simulation-based operations.

## Installing

### Using the dotnet CLI

```
dotnet add package Inhumate.RTI
```

### Using Visual Studio

1. Select *Project* > *Manage NuGet Packages* in the main menu.
2. In the *NuGet Package Manager* page, choose *nuget.org* as the *Package source*.
3. From the *Browse tab*, search for `Inhumate.RTI`, select `Inhumate.RTI` in the list, and then select *Install*.

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

```sh
dotnet restore
dotnet build
dotnet test
```
