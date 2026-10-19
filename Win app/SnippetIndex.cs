using System.Net.Http.Json;
using System.Text.Json;

namespace NinjaSnipp;

// One snippet of the manager's winSnippets (lib/SnippetIndex.php in the PHP app)
public record Snippet(
  List<string> DataSets,
  string Path,
  string? BasePath,
  string Name,
  string Folder,
  string Sc,
  string Short,
  bool Form,      // has placeholders or MAYBE blocks: the fill view
  string? Text    // the text to insert when there is no form
);

// All snippets of the manager, for typed shortcuts. Kept in a cache file, so snippets without
// a form can be inserted before the server is up (XAMPP starts a few minutes after boot).
//
// Read from the keyboard hook's thread, replaced on the UI thread: the list is never changed,
// only swapped for a new one.
public class SnippetIndex
{
  private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

  private readonly string cacheFile;
  private volatile IReadOnlyList<Snippet> snippets = Array.Empty<Snippet>();
  private string? stamp;

  public SnippetIndex( string cacheFile )
  {
    this.cacheFile = cacheFile;
  }

  public IReadOnlyList<Snippet> Snippets => snippets;

  public int LongestSc { get; private set; }

  // Uses the cache, if there is one that can be read
  public void LoadCache()
  {
    try {

      var cache = JsonSerializer.Deserialize<Cache>( File.ReadAllText(cacheFile), Json);
      if( cache != null )
        Set(cache.Snippets, cache.Stamp);
    }
    catch( Exception ) {
      // no cache yet or a broken one: the next refresh writes a new one
    }
  }

  // Asks the manager for changes. True when the snippets are current (changed or not),
  // false when the server can't be reached (the snippets stay as they are).
  public async Task<bool> RefreshAsync( HttpClient http, string appUrl )
  {
    try {

      var response = await http.PostAsJsonAsync($"{appUrl}ajax.php", new { action = "winSnippets", stamp }, Json);
      var result   = await response.Content.ReadFromJsonAsync<WinSnippets>(Json);
      if( result == null || ! result.Success )
        return false;
      if( result.Unchanged )
        return true;

      Set(result.Snippets ?? new(), result.Stamp);

      Directory.CreateDirectory( System.IO.Path.GetDirectoryName(cacheFile)!);
      File.WriteAllText(cacheFile, JsonSerializer.Serialize(new Cache(stamp, snippets.ToList()), Json));
      return true;
    }
    catch( Exception e ) when( e is HttpRequestException || e is TaskCanceledException || e is JsonException || e is IOException ) {
      return false;
    }
  }

  // The snippets whose sc the typed text ends with. When shortcuts of different length match
  // ("err--" and "rr--"), the longest wins: it's the one the user typed.
  public List<Snippet> Match( string typed )
  {
    var matches = snippets.Where( s => s.Sc != "" && typed.EndsWith(s.Sc, StringComparison.Ordinal)).ToList();
    if( matches.Count == 0 )
      return matches;

    int longest = matches.Max( s => s.Sc.Length);
    return matches.Where( s => s.Sc.Length == longest).ToList();
  }

  private void Set( List<Snippet> list, string? newStamp )
  {
    LongestSc = list.Select( s => s.Sc.Length).DefaultIfEmpty(0).Max();
    snippets  = list;
    stamp     = newStamp;
  }

  private record Cache( string? Stamp, List<Snippet> Snippets );

  private record WinSnippets( bool Success, bool Unchanged, string? Stamp, List<Snippet>? Snippets );
}
