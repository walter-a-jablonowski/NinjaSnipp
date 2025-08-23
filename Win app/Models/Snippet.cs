using System;
using System.Collections.Generic;

namespace NinjaSnipp.Models
{
  public class Snippet
  {
    // Unique identifier for the snippet
    public string Identifier { get; set; } = string.Empty;
    
    // Display name of the snippet
    public string Name { get; set; } = string.Empty;
    
    // Text to type to trigger the snippet
    public string Shortcut { get; set; } = string.Empty;
    
    // The actual snippet content
    public string Content { get; set; } = string.Empty;
    
    // Additional comments about the snippet
    public string Comments { get; set; } = string.Empty;
    
    // Tags for categorizing and filtering snippets
    public List<string> Tags { get; set; } = new List<string>();
    
    // Creation date of the snippet
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    
    // Last modified date of the snippet
    public DateTime ModifiedAt { get; set; } = DateTime.Now;
  }
}