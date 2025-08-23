# NinjaSnipp - Snippet Manager for Windows

NinjaSnipp is a system tray application that allows you to manage and quickly insert code snippets anywhere in your system.

## Features

- System-wide hotkey (Ctrl+Alt+Space) to access snippets
- Context menu appears at cursor position
- Type to filter snippets
- Organize snippets with tags
- YAML-based storage for easy backup and version control

## Usage

### Managing Snippets

1. Double-click the system tray icon or right-click and select "Manage Snippets"
2. Create new snippets with a name, shortcut, and content
3. Add optional comments and tags
4. Save your snippets

### Using Snippets

1. Press Ctrl+Alt+Space anywhere in your system
2. A context menu will appear at your cursor position
3. Type to filter snippets
4. Click on a snippet to insert it at the cursor position
5. Alternatively, type the shortcut text to directly insert a snippet

## Data Storage

Snippets are stored as individual YAML files in the `data` folder. Each snippet has the following fields:

- name: Display name of the snippet
- identifier: Unique ID for the snippet
- shortcut: Text to type to insert the snippet
- snippet: The actual content to be inserted
- comments: Additional notes about the snippet
- tags: Categories for organizing snippets

## Requirements

- Windows operating system
- .NET 8.0 SDK or higher
- Visual Studio 2022 (optional)

## Installation

### Option 1: Download the Release

1. Download the latest release from the Releases page
2. Extract the ZIP file to a location of your choice
3. Run `NinjaSnipp.exe`

### Option 2: Build from Source

#### Using Visual Studio

1. Clone or download this repository
2. Open `NinjaSnipp.sln` in Visual Studio 2022
3. Build the solution (Ctrl+Shift+B)
4. Run the application (F5)

#### Using .NET CLI

1. Clone or download this repository
2. Open a command prompt in the project directory
3. Run the following commands:

```
dotnet restore
dotnet build
dotnet run
```

## First Run

When you first run NinjaSnipp:

1. The application will start in the system tray
2. A sample snippet will be created in the `data` folder
3. Press Ctrl+Alt+Space to open the snippet menu
4. Right-click the system tray icon to access additional options