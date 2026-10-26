import XCTest
@testable import FlintAutofillCore

final class FieldClassifierTests: XCTestCase {
    private func tf(_ build: (inout FieldAttributes) -> Void) -> FieldAttributes {
        var a = FieldAttributes(role: "AXTextField"); build(&a); return a
    }

    func testSafariOtpField() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Enter verification code"; $0.domIdentifier = "otp-input"; $0.domClasses = ["input", "text-center"] }), .codeField)
    }
    func testChromeLabelledField() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.labelText = "6-digit code"; $0.description = "Enter the 6-digit code we sent you" }), .codeField)
    }
    func testFirefoxCamelCaseDomId() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.domIdentifier = "verificationCode" }), .codeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.domIdentifier = "twoFactorToken" }), .codeField)
    }
    func testPhrases() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.title = "Security code" }), .codeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.help = "Your one-time passcode" }), .codeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "2FA" }), .codeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.identifier = "pin" }), .codeField)
    }
    func testEmailedCodeStillMatches() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Code we emailed you" }), .codeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Email verification code" }), .codeField)
    }
    func testSecureFieldsNeverMatch() {
        XCTAssertEqual(FieldClassifier.classify(FieldAttributes(role: "AXTextField", subrole: "AXSecureTextField", placeholder: "Verification code")), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(FieldAttributes(role: "AXSecureTextField", placeholder: "Enter PIN")), .notCodeField)
    }
    func testPasswordSearchEmailUsername() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Password" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Search mail" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(FieldAttributes(role: "AXTextField", subrole: "AXSearchField")), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Email address" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Username or email" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.domIdentifier = "login_password_code" }), .notCodeField)
    }
    func testCardSecurityCodeIsNotACode() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "CVV" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "CVC" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Card security code" }), .notCodeField)
    }
    func testOtherKindsOfCodes() {
        for text in ["Zip code", "Postal code", "Promo code", "Coupon code", "Country code", "Referral code"] {
            XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = text }), .notCodeField, text)
        }
    }
    func testWrongRolesAndNoHints() {
        XCTAssertEqual(FieldClassifier.classify(FieldAttributes(role: "AXButton", title: "Verification code")), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(FieldAttributes()), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { _ in }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Shipping notes" }), .notCodeField)
    }
    func testSplitInputs() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1 }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.description = "Digit 3" }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.labelText = "Verification code character 2" }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.placeholder = "Middle initial" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.placeholder = "CVV" }), .notCodeField)
    }
    func testDigitSuffixedAndConcatenatedNames() {
        for id in ["otp1", "code1", "pin2", "verificationcode", "securitycode", "twofactorcode", "smscode", "authcode", "otpinput", "emailotp", "mfaCode2"] {
            XCTAssertEqual(FieldClassifier.classify(tf { $0.domIdentifier = id }), .codeField, id)
        }
        XCTAssertEqual(FieldClassifier.normalize("otp1"), "otp 1")
        XCTAssertEqual(FieldClassifier.classify(tf { $0.title = "footprint" }), .notCodeField)
    }
    func testSplitBoxesWithPlaceholderOnlyHints() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.domIdentifier = "digit1" }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.placeholder = "0" }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.placeholder = "-"; $0.domIdentifier = "input-3" }), .splitCodeField(siblings: 1))
        XCTAssertEqual(FieldClassifier.classify(tf { $0.maxLength = 1; $0.placeholder = "0"; $0.help = "Middle initial" }), .notCodeField)
    }
    func testCardContextBeatsSecurityCode() {
        XCTAssertEqual(FieldClassifier.classify(tf { $0.title = "Security code"; $0.domIdentifier = "encryptedSecurityCode" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.title = "Security code"; $0.help = "Payment details" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.domIdentifier = "ccv2" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.title = "Security code" }), .codeField)
    }
    func testCommonSentCodeWording() {
        for text in ["Enter the code we sent to your phone", "Check your email for the code", "Enter the code sent by text message", "Phone verification code"] {
            XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = text }), .codeField, text)
        }
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Email code" }), .notCodeField)
        XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = "Name code" }), .notCodeField)
    }
    func testMoreNonOtpCodes() {
        for text in ["Sort code", "Gift code", "Branch code", "Tracking code", "zipcode", "promoCode", "Cc"] {
            XCTAssertEqual(FieldClassifier.classify(tf { $0.placeholder = text }), .notCodeField, text)
        }
    }
    func testForbiddenForShortcut() {
        XCTAssertTrue(FieldClassifier.isForbidden(FieldAttributes(role: "AXTextField", subrole: "AXSecureTextField")))
        XCTAssertTrue(FieldClassifier.isForbidden(FieldAttributes(role: "AXSecureTextField")))
        XCTAssertTrue(FieldClassifier.isForbidden(FieldAttributes(role: "AXTextField", subrole: "AXSearchField")))
        XCTAssertTrue(FieldClassifier.isForbidden(tf { $0.placeholder = "Password" }))
        XCTAssertTrue(FieldClassifier.isForbidden(tf { $0.placeholder = "CVV" }))
        XCTAssertFalse(FieldClassifier.isForbidden(tf { $0.placeholder = "Shipping notes" }))
        XCTAssertFalse(FieldClassifier.isForbidden(tf { _ in }))
    }
    func testSplitRuns() {
        let box = { (i: Double) in SiblingField(isTextField: true, maxLength: 1, frame: ScreenRect(x: i * 40, y: 0, width: 32, height: 40)) }
        let wide = SiblingField(isTextField: true, maxLength: nil, frame: ScreenRect(x: 0, y: 0, width: 200, height: 40))
        let button = SiblingField(isTextField: false, maxLength: nil, frame: ScreenRect(x: 0, y: 0, width: 10, height: 10))
        let secure = SiblingField(isTextField: true, isSecure: true, maxLength: 1, frame: ScreenRect(x: 0, y: 0, width: 10, height: 10))
        let all = [wide, box(0), box(1), box(2), box(3), box(4), box(5), button, box(6)]
        XCTAssertEqual(SplitFields.run(siblings: all, focused: 3)?.start, 1)
        XCTAssertEqual(SplitFields.run(siblings: all, focused: 3)?.count, 6)
        XCTAssertNil(SplitFields.run(siblings: all, focused: 8))
        XCTAssertNil(SplitFields.run(siblings: all, focused: 0))
        XCTAssertNil(SplitFields.run(siblings: all, focused: 99))
        XCTAssertEqual(SplitFields.run(siblings: [box(0), secure, box(1)], focused: 0)?.count, nil)
    }

    func testInfersBoxesFromLayout() {
        let box = { (i: Double) in SiblingField(isTextField: true, maxLength: nil, frame: ScreenRect(x: i * 44, y: 100, width: 40, height: 48)) }
        let row = (0..<6).map { box(Double($0)) }
        XCTAssertTrue(SplitFields.looksLikeSplitBoxes(siblings: row, focused: 2))
        XCTAssertFalse(SplitFields.looksLikeSplitBoxes(siblings: Array(row.prefix(3)), focused: 1))
        let wide = SiblingField(isTextField: true, maxLength: nil, frame: ScreenRect(x: 0, y: 100, width: 300, height: 48))
        XCTAssertFalse(SplitFields.looksLikeSplitBoxes(siblings: [wide, wide, wide, wide], focused: 0))
        XCTAssertFalse(SplitFields.looksLikeSplitBoxes(siblings: row, focused: 9))
    }
}
