package poker

import "fmt"

// ErrorCode values match the shared contract catalogue
// (packages/contracts/openapi/control-api.yaml ErrorCode).
type ErrorCode string

// Engine error codes.
const (
	CodeNotYourTurn     ErrorCode = "NOT_YOUR_TURN"
	CodeIllegalAction   ErrorCode = "ILLEGAL_ACTION"
	CodeInvalidRaise    ErrorCode = "INVALID_RAISE"
	CodeHandNotActive   ErrorCode = "HAND_NOT_ACTIVE"
	CodePlayerNotInHand ErrorCode = "PLAYER_NOT_SEATED"
	CodeInvalidConfig   ErrorCode = "VALIDATION_FAILED"
	CodeSeatTaken       ErrorCode = "SEAT_TAKEN"
	CodeAlreadySeated   ErrorCode = "ALREADY_SEATED"
	CodeTableFull       ErrorCode = "TABLE_FULL"
)

// Error is a rule violation with a machine-readable code.
type Error struct {
	Code ErrorCode
	Msg  string
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Msg) }

// Is lets errors.Is match on the code.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func errorf(code ErrorCode, format string, args ...any) *Error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, args...)}
}

// Sentinels for errors.Is comparisons.
var (
	ErrNotYourTurn     = &Error{Code: CodeNotYourTurn}
	ErrIllegalAction   = &Error{Code: CodeIllegalAction}
	ErrInvalidRaise    = &Error{Code: CodeInvalidRaise}
	ErrHandNotActive   = &Error{Code: CodeHandNotActive}
	ErrPlayerNotInHand = &Error{Code: CodePlayerNotInHand}
)
