using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NinjaSnipp.Models;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace NinjaSnipp.Services
{
  public class SnippetService
  {
    private readonly string _dataFolder;
    private readonly ISerializer _serializer;
    private readonly IDeserializer _deserializer;
    private List<Snippet> _snippets;
    
    public SnippetService(string dataFolder = "data")
    {
      // Ensure the data folder path is absolute
      _dataFolder = Path.IsPathRooted(dataFolder) 
        ? dataFolder 
        : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, dataFolder);
      
      // Create the directory if it doesn't exist
      if (!Directory.Exists(_dataFolder))
      {
        Directory.CreateDirectory(_dataFolder);
      }
      
      // Initialize YAML serializer and deserializer
      _serializer = new SerializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();
      
      _deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();
      
      _snippets = new List<Snippet>();
    }
    
    public async Task LoadSnippetsAsync()
    {
      _snippets.Clear();
      
      foreach (var file in Directory.GetFiles(_dataFolder, "*.yml"))
      {
        try
        {
          string yaml = await File.ReadAllTextAsync(file);
          var snippet = _deserializer.Deserialize<Snippet>(yaml);
          _snippets.Add(snippet);
        }
        catch (Exception ex)
        {
          Console.WriteLine($"Error loading snippet from {file}: {ex.Message}");
        }
      }
    }
    
    public async Task SaveSnippetAsync(Snippet snippet)
    {
      // Ensure the snippet has a unique identifier
      if (string.IsNullOrEmpty(snippet.Identifier))
      {
        snippet.Identifier = Guid.NewGuid().ToString();
      }
      
      // Update modification time
      snippet.ModifiedAt = DateTime.Now;
      
      // Serialize to YAML
      string yaml = _serializer.Serialize(snippet);
      string filePath = Path.Combine(_dataFolder, $"{snippet.Identifier}.yml");
      
      // Save to file
      await File.WriteAllTextAsync(filePath, yaml);
      
      // Update in-memory collection
      var existingIndex = _snippets.FindIndex(s => s.Identifier == snippet.Identifier);
      if (existingIndex >= 0)
      {
        _snippets[existingIndex] = snippet;
      }
      else
      {
        _snippets.Add(snippet);
      }
    }
    
    public async Task DeleteSnippetAsync(string identifier)
    {
      string filePath = Path.Combine(_dataFolder, $"{identifier}.yml");
      
      if (File.Exists(filePath))
      {
        await Task.Run(() => File.Delete(filePath));
        _snippets.RemoveAll(s => s.Identifier == identifier);
      }
    }
    
    public List<Snippet> GetAllSnippets()
    {
      return _snippets.ToList();
    }
    
    public List<Snippet> SearchSnippets(string query)
    {
      if (string.IsNullOrWhiteSpace(query))
      {
        return _snippets.ToList();
      }
      
      query = query.ToLowerInvariant();
      
      return _snippets.Where(s =>
        s.Name.ToLowerInvariant().Contains(query) ||
        s.Shortcut.ToLowerInvariant().Contains(query) ||
        s.Tags.Any(t => t.ToLowerInvariant().Contains(query)) ||
        s.Content.ToLowerInvariant().Contains(query)
      ).ToList();
    }
    
    public Snippet? GetSnippetByShortcut(string shortcut)
    {
      return _snippets.FirstOrDefault(s => 
        s.Shortcut.Equals(shortcut, StringComparison.OrdinalIgnoreCase));
    }
  }
}