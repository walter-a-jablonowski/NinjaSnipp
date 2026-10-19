using System.Text;

namespace NinjaSnipp;

// The last characters the user typed, as many as the longest shortcut has
public class TypedText
{
  private readonly StringBuilder text = new();

  public int MaxLength { get; set; } = 1;

  public void Add( char c )
  {
    text.Append(c);
    if( text.Length > MaxLength )
      text.Remove(0, text.Length - MaxLength);
  }

  public void Back()
  {
    if( text.Length > 0 )
      text.Length--;
  }

  public void Clear() => text.Clear();

  public override string ToString() => text.ToString();
}
