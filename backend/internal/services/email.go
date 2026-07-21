package services

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
)

var (
	smtpHost     string
	smtpPort     string
	smtpUsername string
	smtpPassword string
	smtpFrom     string
)

// initEmail reads SMTP configuration from the environment. Unlike Postgres/
// Redis/MinIO, a missing config doesn't fail startup — email verification
// and password reset are the only features that depend on it, so the rest
// of the app should still come up. SendEmail just returns a clear error at
// call time until this is configured.
func initEmail() {
	smtpHost = os.Getenv("SMTP_HOST")
	smtpPort = os.Getenv("SMTP_PORT")
	smtpUsername = os.Getenv("SMTP_USERNAME")
	smtpPassword = os.Getenv("SMTP_PASSWORD")
	smtpFrom = os.Getenv("SMTP_FROM")

	if smtpPort == "" {
		smtpPort = "587"
	}
	if smtpFrom == "" {
		smtpFrom = smtpUsername
	}

	if smtpHost == "" {
		log.Println("⚠️ SMTP_HOST not set — email verification and password reset emails will fail until configured")
	} else {
		log.Printf("✅ SMTP configured (%s:%s, from %s)", smtpHost, smtpPort, smtpFrom)
	}
}

var ErrEmailNotConfigured = fmt.Errorf("email delivery is not configured on this server")

// SendEmail sends a plain-text email via SMTP, authenticating with
// SMTP_USERNAME/SMTP_PASSWORD. Works against any standard SMTP-AUTH
// provider (Gmail with an app password, SendGrid/Mailgun/SES SMTP relays,
// a self-hosted Postfix, etc) — port 465 is dialed with implicit TLS,
// anything else (587, 25) negotiates STARTTLS via the stdlib's SendMail.
func SendEmail(to, subject, body string) error {
	if smtpHost == "" {
		return ErrEmailNotConfigured
	}

	addr := net.JoinHostPort(smtpHost, smtpPort)
	auth := smtp.PlainAuth("", smtpUsername, smtpPassword, smtpHost)
	msg := []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n",
		smtpFrom, to, subject, body,
	))

	if smtpPort == "465" {
		return sendMailImplicitTLS(addr, auth, smtpFrom, to, msg)
	}

	if err := smtp.SendMail(addr, auth, smtpFrom, []string{to}, msg); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	return nil
}

// sendMailImplicitTLS handles providers on port 465, where TLS wraps the
// connection from the first byte rather than being negotiated mid-session
// via STARTTLS (which is all net/smtp.SendMail supports natively).
func sendMailImplicitTLS(addr string, auth smtp.Auth, from, to string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: smtpHost})
	if err != nil {
		return fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, smtpHost)
	if err != nil {
		return fmt.Errorf("failed to start SMTP session: %w", err)
	}
	defer client.Quit()

	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("SMTP auth failed: %w", err)
	}
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("SMTP MAIL FROM failed: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("SMTP RCPT TO failed: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP DATA failed: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("failed to write email body: %w", err)
	}
	return w.Close()
}
