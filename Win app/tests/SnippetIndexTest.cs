using System.Net;
using System.Text;

namespace NinjaSnipp.Tests;

public class SnippetIndexTest : IDisposable
{
  private readonly string dir = Path.Combine(Path.GetTempPath(), $"ninja_win_test_{Guid.NewGuid():N}");

  private string CacheFile => Path.Combine(dir, "index.json");

  public void Dispose()
  {
    if( Directory.Exists(dir) )
      Directory.Delete(dir, true);
  }

  private static string Entry( string name, string sc, bool form = false, string dataSet = "Common" ) =>
    $$"""{"dataSets": ["{{dataSet}}"], "path": "{{name}}.yml", "basePath": null, "name": "{{name}}", "folder": "", "sc": "{{sc}}", "short": "", "form": {{(form ? "true" : "false")}}, "text": {{(form ? "null" : $"\"text of {name}\"")}}}""";

  private static string Answer( string stamp, params string[] entries ) =>
    $$"""{"success": true, "stamp": "{{stamp}}", "dataSets": ["Common"], "snippets": [{{string.Join(",", entries)}}]}""";

  // An HttpClient whose server answers with the given JSON bodies, one per request
  private static (HttpClient Http, List<string> Requests) Server( params string[] answers )
  {
    var requests = new List<string>();
    var handler  = new FakeHandler(answers, requests);
    return (new HttpClient(handler), requests);
  }

  [Fact]
  public async Task RefreshLoadsTheSnippetsAndPollsWithTheStamp()
  {
    var (http, requests) = Server( Answer("s1", Entry("log", "log--")), """{"success": true, "unchanged": true}""");
    var index = new SnippetIndex(CacheFile);

    Assert.True( await index.RefreshAsync(http, "http://x/"));
    Assert.Equal("log--", index.Snippets.Single().Sc);
    Assert.Equal(5, index.LongestSc);

    Assert.True( await index.RefreshAsync(http, "http://x/"));
    Assert.Contains("\"stamp\":\"s1\"", requests[1]);
    Assert.Single(index.Snippets);                       // unchanged: kept
  }

  [Fact]
  public async Task TheCacheKeepsTheSnippetsForTheNextStart()
  {
    var (http, _) = Server( Answer("s1", Entry("log", "log--")));
    await new SnippetIndex(CacheFile).RefreshAsync(http, "http://x/");

    var next = new SnippetIndex(CacheFile);
    next.LoadCache();

    Assert.Equal("text of log", next.Snippets.Single().Text);
  }

  [Fact]
  public async Task AServerThatIsDownChangesNothing()
  {
    var index = new SnippetIndex(CacheFile);
    var http  = new HttpClient( new FakeHandler(Array.Empty<string>(), new()));   // throws: no answer

    Assert.False( await index.RefreshAsync(http, "http://x/"));
    Assert.Empty(index.Snippets);

    index.LoadCache();                                   // no cache file yet: no error
    Assert.Empty(index.Snippets);
  }

  [Fact]
  public async Task MatchFindsTheShortcutAtTheEndOfTheTypedText()
  {
    var (http, _) = Server( Answer("s1",
      Entry("err", "err--"), Entry("rr", "rr--"), Entry("log", "log--"), Entry("log2", "log--", true, "Dev"), Entry("none", "")));
    var index = new SnippetIndex(CacheFile);
    await index.RefreshAsync(http, "http://x/");

    Assert.Empty( index.Match("some text"));
    Assert.Empty( index.Match("err-"));
    Assert.Equal(new[] { "err" }, index.Match("x err--").Select(s => s.Name));      // the longest shortcut wins
    Assert.Equal(new[] { "rr" }, index.Match("rr--").Select(s => s.Name));
    Assert.Equal(new[] { "log", "log2" }, index.Match("log--").Select(s => s.Name)); // several: the picker decides
    Assert.Empty( index.Match(""));                                                  // an empty sc never matches
  }

  private class FakeHandler : HttpMessageHandler
  {
    private readonly Queue<string> answers;
    private readonly List<string> requests;

    public FakeHandler( IEnumerable<string> answers, List<string> requests )
    {
      this.answers  = new Queue<string>(answers);
      this.requests = requests;
    }

    protected override async Task<HttpResponseMessage> SendAsync( HttpRequestMessage request, CancellationToken cancellationToken )
    {
      requests.Add( await request.Content!.ReadAsStringAsync(cancellationToken));
      if( answers.Count == 0 )
        throw new HttpRequestException("connection refused");

      return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(answers.Dequeue(), Encoding.UTF8, "application/json") };
    }
  }
}
