package poker

// EvaluateOmaha returns the best Omaha hand: exactly two of the hole cards
// combined with exactly three of the board cards (all 6 x 10 = 60
// combinations for four hole cards and a full board). It also returns the
// five cards used. It requires at least two hole cards and three board
// cards.
func EvaluateOmaha(hole, board []Card) (HandValue, []Card) {
	var best HandValue
	var bestFive []Card
	five := make([]Card, 5)
	for a := 0; a < len(hole); a++ {
		for b := a + 1; b < len(hole); b++ {
			for x := 0; x < len(board); x++ {
				for y := x + 1; y < len(board); y++ {
					for z := y + 1; z < len(board); z++ {
						five[0], five[1] = hole[a], hole[b]
						five[2], five[3], five[4] = board[x], board[y], board[z]
						if v := Evaluate(five); bestFive == nil || v > best {
							best = v
							_, bestFive = EvaluateBest(five)
						}
					}
				}
			}
		}
	}
	return best, bestFive
}
