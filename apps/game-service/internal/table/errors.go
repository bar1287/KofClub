package table

import (
	"errors"
	"fmt"

	"github.com/bar1287/kofclub/go/poker"
)

// Error is a machine-readable rejection using the shared error-code
// catalogue (packages/contracts/openapi/control-api.yaml ErrorCode).
type Error struct {
	Code    string
	Message string
	Details map[string]any
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// Is matches errors by code.
func (e *Error) Is(target error) bool {
	var t *Error
	return errors.As(target, &t) && t.Code == e.Code
}

func newError(code, msg string) *Error { return &Error{Code: code, Message: msg} }

// Sentinels.
var (
	ErrStopped        = newError("TABLE_UNAVAILABLE", "table actor is not running")
	ErrResyncRequired = newError("STALE_GAME_STATE", "requested events are no longer retained; resync from a snapshot")
)

// fromEngine maps engine rule violations to API errors.
func fromEngine(err error) *Error {
	var pe *poker.Error
	if errors.As(err, &pe) {
		code := string(pe.Code)
		if pe.Code == poker.CodeInvalidConfig {
			code = "ILLEGAL_ACTION"
		}
		return &Error{Code: code, Message: pe.Msg}
	}
	return &Error{Code: "INTERNAL", Message: "unexpected engine error"}
}
