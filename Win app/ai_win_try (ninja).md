
new: data recursive

Make a snippet manager for Win

Snippets are saved in a data folder (currently /data) one yml file per snippet. There may be sub folders with snippets (multiple levels).

## Format

Fields in a snippet at least:

- name
- identifier (string) defined by the user (unique) used for unique identification when the name changes
- shortcut (a text to type to insert the snippet)
- snippet
- comments
- tags

## Win system tray app

Primary language to use is C#, I have provided you a basic c# project made with Visual Studio (add the neccessary code)

- systemwide usable shortcut for inserting snippet
  - on press of a shortut some kind of context menu appears at cursor position
  - within the menu type to filter the list
- alternatively we can just type a shortcut to insert a snippet

## Coding rules

- Indent all codes with 2 spaces and put the { on the next line
- Use of blanks like: `if( $condition )`
