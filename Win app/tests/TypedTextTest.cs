namespace NinjaSnipp.Tests;

public class TypedTextTest
{
  private static TypedText Typed( string text, int maxLength )
  {
    var typed = new TypedText { MaxLength = maxLength };
    foreach( char c in text )
      typed.Add(c);
    return typed;
  }

  [Fact]
  public void KeepsTheLastCharacters()
  {
    Assert.Equal("log--", Typed("some log--", 5).ToString());
  }

  [Fact]
  public void BackspaceRemovesTheLastCharacter()
  {
    var typed = Typed("log-x", 5);
    typed.Back();
    typed.Add('-');

    Assert.Equal("log--", typed.ToString());

    typed.Clear();
    typed.Back();                                        // nothing to remove: no error
    Assert.Equal("", typed.ToString());
  }
}
