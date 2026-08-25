import QtQuick
import qs.Commons

// Drawn from plain Rectangles rather than a Nerd Font glyph, same reasoning
// as LockIcon.qml/TailscaleIcon.qml: font glyphs pick up color fringing in
// this bar's tiny icon slot.
Item {
  id: root

  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property bool active: false

  width: iconSize
  height: iconSize
  implicitWidth: iconSize
  implicitHeight: iconSize

  readonly property real strokeWidth: Math.max(1.2, iconSize * 0.09)
  readonly property real bodyWidth: iconSize * 0.86
  readonly property real bodyHeight: iconSize * 0.6

  Rectangle {
    id: body
    width: root.bodyWidth
    height: root.bodyHeight
    radius: Math.min(width, height) * 0.18
    color: "transparent"
    border.width: root.strokeWidth
    border.color: root.color
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
  }

  Rectangle {
    width: root.iconSize * 0.28
    height: root.iconSize * 0.14
    radius: height * 0.3
    color: root.color
    anchors.bottom: body.top
    anchors.bottomMargin: -root.strokeWidth * 0.6
    anchors.horizontalCenter: parent.horizontalCenter
    x: root.iconSize * 0.16
  }

  Rectangle {
    width: root.iconSize * 0.34
    height: width
    radius: width / 2
    color: "transparent"
    border.width: root.strokeWidth
    border.color: root.color
    anchors.centerIn: body

    Rectangle {
      visible: root.active
      width: parent.width * 0.5
      height: width
      radius: width / 2
      color: root.color
      anchors.centerIn: parent
    }
  }
}
