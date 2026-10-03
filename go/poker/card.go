package poker

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Rank is a card rank from 2 to 14 (ace high).
type Rank uint8

// Suit is one of the four suits.
type Suit uint8

// Ranks.
const (
	Two Rank = iota + 2
	Three
	Four
	Five
	Six
	Seven
	Eight
	Nine
	Ten
	Jack
	Queen
	King
	Ace
)

// Suits.
const (
	Clubs Suit = iota
	Diamonds
	Hearts
	Spades
)

const (
	rankChars = "23456789TJQKA"
	suitChars = "cdhs"
	// DeckSize is the number of cards in a standard deck.
	DeckSize = 52
)

// Card is a playing card encoded as (rank-2)*4 + suit, i.e. 0..51.
type Card uint8

// NewCard builds a card from rank and suit.
func NewCard(r Rank, s Suit) Card { return Card(uint8(r-Two)*4 + uint8(s)) }

// Rank returns the card rank.
func (c Card) Rank() Rank { return Rank(uint8(c)/4) + Two }

// Suit returns the card suit.
func (c Card) Suit() Suit { return Suit(uint8(c) % 4) }

// Valid reports whether c encodes a real card.
func (c Card) Valid() bool { return c < DeckSize }

// String renders a card as rank+suit, e.g. "As", "Td", "2c".
func (c Card) String() string {
	if !c.Valid() {
		return "??"
	}
	return string([]byte{rankChars[c.Rank()-Two], suitChars[c.Suit()]})
}

// ParseCard parses "As", "td", "2C" etc.
func ParseCard(s string) (Card, error) {
	if len(s) != 2 {
		return 0, fmt.Errorf("poker: invalid card %q", s)
	}
	r := strings.IndexByte(rankChars, strings.ToUpper(s[:1])[0])
	su := strings.IndexByte(suitChars, strings.ToLower(s[1:])[0])
	if r < 0 || su < 0 {
		return 0, fmt.Errorf("poker: invalid card %q", s)
	}
	return NewCard(Rank(r)+Two, Suit(su)), nil
}

// MustParseCards parses a space-separated card list and panics on error
// (test helper).
func MustParseCards(s string) []Card {
	cards, err := ParseCards(s)
	if err != nil {
		panic(err)
	}
	return cards
}

// ParseCards parses a space-separated list such as "As Kd 7h".
func ParseCards(s string) ([]Card, error) {
	fields := strings.Fields(s)
	out := make([]Card, 0, len(fields))
	for _, f := range fields {
		c, err := ParseCard(f)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// MarshalJSON encodes a card as its two-character string.
func (c Card) MarshalJSON() ([]byte, error) { return json.Marshal(c.String()) }

// UnmarshalJSON decodes the two-character string form.
func (c *Card) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	parsed, err := ParseCard(s)
	if err != nil {
		return err
	}
	*c = parsed
	return nil
}

// CardsString renders cards separated by spaces.
func CardsString(cards []Card) string {
	parts := make([]string, len(cards))
	for i, c := range cards {
		parts[i] = c.String()
	}
	return strings.Join(parts, " ")
}
