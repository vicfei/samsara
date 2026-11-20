package handler

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
)

// S-26 复现：OIDC 回调 payload 的 is_new_user 带 omitempty ——
// 首次 OIDC 登录（服务层开户，isNewUser=true，user.go LoginWithOIDC）payload 含
// "is_new_user":true；后续登录（存量用户，isNewUser=false）同一端点的 payload
// 中该字段整个消失。经 encodeOIDCCallbackPayload（auth.go:463，真实投递边界：
// JSON→base64→redirect fragment #oidc_result=）验证。
func TestReproOIDCCallbackIsNewUserAsymmetry(t *testing.T) {
	build := func(isNew bool) string {
		payload, err := encodeOIDCCallbackPayload(&types.OIDCCallbackResponse{
			Success:      true,
			Token:        "tok",
			RefreshToken: "ref",
			IsNewUser:    isNew,
		})
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		raw, err := base64.RawURLEncoding.DecodeString(payload)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		return string(raw)
	}

	first := build(true)
	subsequent := build(false)
	t.Logf("first login payload:      %s", first)
	t.Logf("subsequent login payload: %s", subsequent)

	if !strings.Contains(first, `"is_new_user":true`) {
		t.Fatalf("首登 payload 应含 is_new_user:true，实得: %s", first)
	}
	if strings.Contains(subsequent, `"is_new_user"`) {
		t.Fatalf("缺陷未复现：后续登录 payload 仍含 is_new_user 字段，实得: %s", subsequent)
	}
	// 走到这里 = 缺陷复现成功：同一端点，字段「首登出现/后续消失」
}
